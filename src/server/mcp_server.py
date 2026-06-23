#!/usr/bin/env python3
"""
mcp_server.py — VizCode MCP stdio server

Implements the Model Context Protocol (MCP) over stdio (JSON-RPC 2.0,
Content-Length framing, same as LSP).

Usage:
    python mcp_server.py --scan .vizcode/scan_cache.json \
                         --sem  .vizcode/semantic_cache.json

Tools exposed:
    vizcode_context(question)     — one-shot ranked subgraph (prefer this first)
    vizcode_trace(source, target) — dependency path with inline signatures + linking symbol
    vizcode_query(question)       — keyword-match modules + semantic edges
    vizcode_path(source, target)  — shortest dependency path (BFS)
    vizcode_explain(symbol)       — module role + direct connections
    vizcode_report()              — full Markdown codebase report (token-saving overview)
    vizcode_l3(file)              — detailed per-file symbol browser
"""

import argparse
import hashlib
import json
import re
import sys
from collections import deque
from pathlib import Path
from typing import Optional, Tuple

# ─── Wire protocol ───────────────────────────────────────────────────────────

def _read_message(stream) -> Optional[dict]:
    """Read one Content-Length-framed JSON-RPC message from stream."""
    headers = {}
    while True:
        line = stream.readline()
        if not line:
            return None
        line = line.rstrip(b"\r\n")
        if not line:
            break
        if b":" in line:
            k, _, v = line.partition(b":")
            headers[k.strip().lower().decode()] = v.strip().decode()

    length = int(headers.get("content-length", 0))
    if length == 0:
        return None
    body = stream.read(length)
    return json.loads(body.decode("utf-8"))


def _send_message(stream, obj: dict) -> None:
    """Write one Content-Length-framed JSON-RPC message to stream."""
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode()
    stream.write(header + body)
    stream.flush()


def _ok(req_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _err(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


# ─── Data loading ─────────────────────────────────────────────────────────────

def _load_json(path: str) -> dict:
    p = Path(path)
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _scan_cache_hash(scan: dict) -> str:
    return hashlib.sha256(
        json.dumps(scan, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _semantic_cache_is_current(scan: dict, sem: dict) -> bool:
    """Return False only when the cache carries a scan hash and it differs."""
    stored = sem.get("scan_hash", "") if isinstance(sem, dict) else ""
    if not stored:
        return True
    return stored == _scan_cache_hash(scan)


def _semantic_notice(edges: list) -> str:
    return next((e.get("reason", "") for e in edges if e.get("kind") == "notice"), "")


# ─── Import name extraction ──────────────────────────────────────────────────

def _imp_name(imp) -> str:
    """Normalise an import entry to a plain module-name string.

    Handles three formats produced by different parsers:
      str   — 'os', 'analyze_viz'
      dict  — {'target': 'analyze_viz', ...}
      list  — ['dependency', 'axios', 0]  (package.json parser)
    """
    if isinstance(imp, str):
        return imp
    if isinstance(imp, dict):
        return imp.get("target", "")
    if isinstance(imp, list) and len(imp) >= 2:
        return str(imp[1])
    return ""


# ─── Index building ───────────────────────────────────────────────────────────

def _confidence_label(kind, confidence) -> str:
    """Map an edge's (kind, confidence) to a three-state trust label.

    EXTRACTED — parsed straight from source (static import, AST-exact).
    INFERRED  — semantically inferred with usable confidence (>= 0.5).
    AMBIGUOUS — low confidence (< 0.5), conflicting, or unknown.

    Stdlib-only mirror of analytics_helpers.confidence_label; kept local because
    this server runs as a standalone process and does not import core. Lets an
    LLM trust EXTRACTED/INFERRED edges and only re-open source for AMBIGUOUS ones.
    """
    k = (kind or "").lower()
    try:
        conf = float(confidence)
    except (TypeError, ValueError):
        conf = None
    if "infer" in k or k == "semantic":
        return "INFERRED" if (conf is not None and conf >= 0.5) else "AMBIGUOUS"
    if conf is None or conf >= 1.0:
        return "EXTRACTED"
    if conf >= 0.5:
        return "INFERRED"
    return "AMBIGUOUS"


def _build_index(scan: dict, sem: dict):
    """
    Returns:
        modules  — dict[name -> payload dict]  (from scan_cache entries)
        edges    — list[{source, target, kind, confidence, reason, label}]
        adj      — dict[name -> list[name]]  (adjacency for BFS, both directions)
    """
    modules = {}
    entries = scan.get("entries", {})
    for name, entry in entries.items():
        payload = entry.get("payload", {})
        modules[name] = {
            "imports":            payload.get("imports", []),
            "funcdefs":           payload.get("funcdefs", []),
            "funccalls":          payload.get("funccalls", []),
            "func_calls_by_func": payload.get("func_calls_by_func", []),
            "symdefs":            payload.get("symdefs", []),
            "extras":             payload.get("extras", {}),
        }

    edges = []
    # Static import edges from scan_cache
    for src_name, m in modules.items():
        for imp in m["imports"]:
            tgt = _imp_name(imp)
            if tgt and tgt in modules:
                edges.append({"source": src_name, "target": tgt,
                               "kind": "import", "confidence": 1.0, "reason": "",
                               "label": _confidence_label("import", 1.0)})

    # Inferred edges from semantic_cache. If the cache carries a scan hash and
    # it is stale, omit inferred edges so old relationships do not enter prompts.
    if sem.get("edges") and not _semantic_cache_is_current(scan, sem):
        edges.append({
            "source": "",
            "target": "",
            "kind": "notice",
            "confidence": 0.0,
            "reason": "Semantic cache ignored because it does not match the current scan.",
            "label": "AMBIGUOUS",
        })
    else:
        for e in sem.get("edges", []):
            src = e.get("source", "")
            tgt = e.get("target", "")
            if not src or not tgt:
                continue
            conf = e.get("confidence", 0.0)
            edges.append({
                "source":     src,
                "target":     tgt,
                "kind":       "inferred",
                "confidence": conf,
                "reason":     e.get("reason", ""),
                "label":      _confidence_label("inferred", conf),
            })

    # Adjacency list (undirected for BFS path finding)
    adj: dict[str, list[str]] = {n: [] for n in modules}
    for e in edges:
        s, t = e["source"], e["target"]
        if s in adj and t in modules:
            if t not in adj[s]:
                adj[s].append(t)
        if t in adj and s in modules:
            if s not in adj.get(t, []):
                adj.setdefault(t, []).append(s)

    return modules, edges, adj


# ─── Stem index ───────────────────────────────────────────────────────────────

def _build_stem_index(modules: dict) -> Tuple[dict, dict]:
    """
    Group files by top-level directory; build stem→path lookup for import resolution.

    Returns:
        mod_to_files — dict[module_name -> list[file_key]]
                       module_name = top-level dir, or '.' for root files
        stem_to_key  — dict[stem -> file_key]
                       'analyze_viz'          -> 'analyze_viz.py'
                       'parsers/python_parser' -> 'parsers/python_parser.py'
                       (first-seen wins on collision)
    """
    from collections import defaultdict
    import os.path

    mod_to_files: dict[str, list[str]] = defaultdict(list)
    stem_to_key: dict[str, str] = {}

    for key in modules:
        parts = key.split("/")
        mod = parts[0] if len(parts) > 1 else "."
        mod_to_files[mod].append(key)
        full_stem = os.path.splitext(key)[0]        # 'parsers/python_parser'
        base_stem  = os.path.basename(full_stem)    # 'python_parser'
        stem_to_key.setdefault(full_stem, key)
        stem_to_key.setdefault(base_stem, key)

    return dict(mod_to_files), stem_to_key


# ─── Symbol index + centrality ────────────────────────────────────────────────

def _build_symbol_index(modules: dict, stem_to_key: dict) -> dict:
    """Build a cross-file symbol resolution + centrality index from scan_cache.

    Everything here is derived from data already in scan_cache.json (symdefs,
    func_calls_by_func, imports) — no parser or pipeline changes. Computed once
    at load time alongside _build_index / _build_stem_index.

    Returns:
        defs       — name -> list[{file,kind,line,end_line,signature,doc,is_public}]
                     (cross-file name->defining-site resolver; ambiguity kept as a list)
        file_indeg — file_key -> inbound import count
        sym_indeg  — (file_key, name) -> inbound call count
        callers    — (file_key, name) -> set[(file_key, name)]  (who calls it)
        callees    — (file_key, name) -> set[(file_key, name)]  (what it calls)
        file_score — file_key -> 0..1   (min-max normalised file_indeg)
        sym_score  — (file_key, name) -> 0..1   (min-max normalised sym_indeg)
    """
    from collections import defaultdict

    def _qualified_name(sd: dict) -> str:
        name = sd.get("name", "")
        parent = sd.get("parent") or ""
        return f"{parent}.{name}" if parent else name

    qname_counts: dict[tuple, int] = defaultdict(int)
    for fkey, m in modules.items():
        for sd in (m.get("symdefs") or []):
            name = sd.get("name", "")
            if name:
                qname_counts[(fkey, _qualified_name(sd))] += 1

    # ── name -> list of defining sites ────────────────────────────────────────
    defs: dict[str, list[dict]] = defaultdict(list)
    for fkey, m in modules.items():
        extras = m.get("extras") or {}
        docs = extras.get("docstrings", {}) if isinstance(extras, dict) else {}
        for sd in (m.get("symdefs") or []):
            name = sd.get("name", "")
            if not name:
                continue
            qname = _qualified_name(sd)
            stable_id = f"{fkey}::{qname}"
            if qname_counts.get((fkey, qname), 0) > 1 and sd.get("line") is not None:
                stable_id += f":{sd.get('line')}"
            defs[name].append({
                "file":      fkey,
                "kind":      sd.get("kind", "?"),
                "line":      sd.get("line"),
                "end_line":  sd.get("end_line"),
                "signature": sd.get("signature") or "",
                "doc":       (sd.get("doc") or docs.get(name, "") or ""),
                "is_public": sd.get("is_public", True),
                "qualified_name": qname,
                "stable_id": stable_id,
            })

    # ── file-level import in-degree + resolved undirected adjacency ───────────
    # NOTE: _build_index's `adj` keys edges on raw import names that rarely equal a
    # file key, so it is sparse. Here we resolve imports through stem_to_key (as
    # _tool_l0 / _tool_health do) to get a usable adjacency for tracing.
    file_indeg: dict[str, int] = {k: 0 for k in modules}
    file_adj: dict[str, set] = {k: set() for k in modules}
    file_imports: dict[str, set] = {k: set() for k in modules}
    file_importers: dict[str, set] = {k: set() for k in modules}
    for fkey, m in modules.items():
        for imp in (m.get("imports") or []):
            resolved = stem_to_key.get(_imp_name(imp))
            if resolved and resolved != fkey and resolved in file_indeg:
                file_indeg[resolved] += 1
                file_adj[fkey].add(resolved)
                file_adj[resolved].add(fkey)
                file_imports[fkey].add(resolved)
                file_importers[resolved].add(fkey)

    def _resolve_callee(callee: str, src_file: str) -> Optional[str]:
        sites = defs.get(callee)
        if not sites:
            return None                       # 0 matches -> drop (filters get/append/etc.)
        if len(sites) == 1:
            return sites[0]["file"]
        if any(s["file"] == src_file for s in sites):
            return src_file                   # prefer a same-file definition
        return max(sites, key=lambda s: file_indeg.get(s["file"], 0))["file"]

    # ── symbol-level call in-degree + caller/callee adjacency ─────────────────
    sym_indeg: dict[tuple, int] = defaultdict(int)
    callers: dict[tuple, set] = defaultdict(set)
    callees: dict[tuple, set] = defaultdict(set)
    for fkey, m in modules.items():
        funcdefs = m.get("funcdefs") or []
        fcbf = m.get("func_calls_by_func") or []
        for i, fd in enumerate(funcdefs):
            label = fd.get("label") if isinstance(fd, dict) else str(fd)
            if not label:
                continue
            src = (fkey, label)
            calls = fcbf[i] if i < len(fcbf) else []   # same guard as _tool_l2
            for c in dict.fromkeys(calls):             # dedupe, preserve order
                if not isinstance(c, str):
                    continue
                tgt_file = _resolve_callee(c, fkey)
                if tgt_file is None:
                    continue
                tgt = (tgt_file, c)
                if tgt == src:
                    continue
                sym_indeg[tgt] += 1
                callers[tgt].add(src)
                callees[src].add(tgt)

    # ── normalise in-degrees to 0..1 ──────────────────────────────────────────
    def _norm(d: dict) -> dict:
        mx = max(d.values()) if d else 0
        if mx <= 0:
            return {k: 0.0 for k in d}
        return {k: v / mx for k, v in d.items()}

    return {
        "defs":       dict(defs),
        "file_indeg": file_indeg,
        "file_adj":   {k: list(v) for k, v in file_adj.items()},
        "file_imports": {k: list(v) for k, v in file_imports.items()},
        "file_importers": {k: list(v) for k, v in file_importers.items()},
        "sym_indeg":  dict(sym_indeg),
        "callers":    dict(callers),
        "callees":    dict(callees),
        "file_score": _norm(file_indeg),
        "sym_score":  _norm(dict(sym_indeg)),
    }


# ─── Tool implementations ─────────────────────────────────────────────────────

def _tool_l0(modules: dict, mod_to_files: dict, stem_to_key: dict) -> str:
    """L0: codebase-level module overview with inter-module edges."""
    import os.path

    module_names = set(mod_to_files.keys())

    # ── inter-module edges via import resolution ──────────────────────────────
    inter_edges: set[tuple[str, str]] = set()
    for key, m in modules.items():
        src_mod = key.split("/")[0] if "/" in key else "."
        for imp in (m.get("imports") or []):
            tgt_name = _imp_name(imp)
            if not tgt_name:
                continue
            # Case A: import name is a known module directory (e.g. 'parsers')
            if tgt_name in module_names and tgt_name != src_mod:
                inter_edges.add((src_mod, tgt_name))
            # Case B: import name matches a file stem → derive its module
            resolved = stem_to_key.get(tgt_name)
            if resolved and resolved != key:
                tgt_mod = resolved.split("/")[0] if "/" in resolved else "."
                if tgt_mod != src_mod:
                    inter_edges.add((src_mod, tgt_mod))

    # ── format output ─────────────────────────────────────────────────────────
    lines = [
        "=== Codebase Overview (L0) ===",
        f"{len(module_names)} modules | {len(modules)} files total",
        "",
        "Modules (call vizcode_l1(module) to expand):",
    ]
    for mod in sorted(module_names):
        files = sorted(mod_to_files[mod])
        lines.append(f"  [{mod}]  {len(files)} files")
        for f in files[:5]:
            lines.append(f"    {os.path.basename(f)}")
        if len(files) > 5:
            lines.append(f"    ...+{len(files) - 5} more")

    lines.extend(["", "Inter-module dependencies:"])
    if inter_edges:
        for src, tgt in sorted(inter_edges):
            lines.append(f"  {src}  ->  {tgt}")
    else:
        lines.append("  (none resolved from imports)")

    # ── entry points: files with no inbound imports ───────────────────────────
    inbound: dict[str, int] = {k: 0 for k in modules}
    for key, m in modules.items():
        for imp in (m.get("imports") or []):
            tgt_name = _imp_name(imp)
            resolved = stem_to_key.get(tgt_name)
            if resolved and resolved in inbound and resolved != key:
                inbound[resolved] += 1

    # Only show files that have actual code (funcdefs or imports), not data/config files
    entry_pts = sorted(
        k for k, cnt in inbound.items()
        if cnt == 0
        and (modules[k].get("funcdefs") or modules[k].get("imports"))
    )
    lines.extend(["", "Entry points (code files not imported by anyone):"])
    if entry_pts:
        for ep in entry_pts[:10]:
            lines.append(f"  {ep}")
        if len(entry_pts) > 10:
            lines.append(f"  ...+{len(entry_pts) - 10} more")
    else:
        lines.append("  (none — all code files are imported)")

    return "\n".join(lines)


def _tool_l1(module: str, modules: dict, mod_to_files: dict, stem_to_key: dict) -> str:
    """L1: file-level dependency graph within a module."""
    import os.path

    module = module.rstrip("/") or "."
    if module not in mod_to_files:
        available = ", ".join(sorted(mod_to_files.keys()))
        return (
            f"Module '{module}' not found.\n"
            f"Available: {available}\n"
            "Tip: use vizcode_l0() to see all modules."
        )

    files     = sorted(mod_to_files[module])
    file_set  = set(files)
    all_mods  = set(mod_to_files.keys())
    intra: list[tuple[str, str]] = []
    cross: set[tuple[str, str]] = set()

    for f in files:
        m      = modules.get(f, {})
        f_base = os.path.basename(f)
        for imp in (m.get("imports") or []):
            tgt_name = _imp_name(imp)
            if not tgt_name:
                continue
            resolved = stem_to_key.get(tgt_name)
            if resolved and resolved != f:
                if resolved in file_set:
                    intra.append((f_base, os.path.basename(resolved)))
                else:
                    tgt_mod = resolved.split("/")[0] if "/" in resolved else "."
                    if tgt_mod != module:
                        cross.add((f_base, tgt_mod))
                continue
            if tgt_name in all_mods and tgt_name != module:
                cross.add((f_base, tgt_name))

    lines = [
        f"=== Module: {module} (L1) ===",
        f"{len(files)} files | use vizcode_l2(file) for function-level detail",
        "", "Files:",
    ]
    for f in files:
        m_data  = modules.get(f, {})
        n_funcs = len(m_data.get("funcdefs", []) or [])
        ext     = os.path.splitext(f)[1] or '?'
        try:
            sz       = os.path.getsize(f) // 1024
            size_str = f"{sz}KB" if sz > 0 else "<1KB"
        except OSError:
            size_str = "?"
        lines.append(f"  {f}  [{ext}, {n_funcs} funcs, {size_str}]")

    lines.extend(["", "Intra-module import edges:"])
    if intra:
        for src, tgt in intra:
            lines.append(f"  {src}  ->  {tgt}")
    else:
        lines.append("  (none)")

    lines.extend(["", "Cross-module imports:"])
    if cross:
        for src, tgt in sorted(cross):
            lines.append(f"  {src}  ->  [{tgt}]")
    else:
        lines.append("  (none)")

    return "\n".join(lines)


def _tool_l2(file_key: str, modules: dict) -> str:
    """L2: function call graph + symbol definitions for a single file."""
    import os.path

    # ── file resolution ───────────────────────────────────────────────────────
    if file_key not in modules:
        candidates = [k for k in modules if file_key.lower() in k.lower()]
        if not candidates:
            return (
                f"File not found: {file_key!r}\n"
                "Tip: use vizcode_l1(module) to list exact file paths."
            )
        exact = [c for c in candidates
                 if os.path.basename(c).lower() == file_key.lower()]
        file_key = (exact or candidates)[0]

    m          = modules[file_key]
    funcdefs   = m.get("funcdefs", []) or []
    func_calls = m.get("func_calls_by_func", []) or []
    symdefs    = m.get("symdefs", []) or []

    # ── docstring lookup from extras ──────────────────────────────────────────
    extras     = m.get("extras") or {}
    docstrings: dict = {}
    if isinstance(extras, dict):
        docstrings = extras.get("docstrings") or {}

    # ── symdef lookup for line ranges ─────────────────────────────────────────
    sym_by_name: dict[str, dict] = {}
    for sd in symdefs:
        name = sd.get("name", "")
        if name and name not in sym_by_name:
            sym_by_name[name] = sd

    # ── function call graph ───────────────────────────────────────────────────
    lines = [
        f"=== {file_key} (L2) ===",
        f"{len(funcdefs)} functions",
        "", "Function call graph:",
    ]
    for i, fd in enumerate(funcdefs):
        label     = fd.get("label") if isinstance(fd, dict) else str(fd)
        is_static = fd.get("is_static", True) if isinstance(fd, dict) else True
        calls_raw = func_calls[i] if i < len(func_calls) else []

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique_calls: list[str] = []
        for c in calls_raw:
            if c not in seen:
                seen.add(c)
                unique_calls.append(c)

        sd         = sym_by_name.get(label)
        line_range = f"[L{sd['line']}-{sd['end_line']}]" if sd else ""
        vis        = "+" if not is_static else ""
        calls_str  = ", ".join(unique_calls[:10])
        if len(unique_calls) > 10:
            calls_str += ", ..."

        suffix = f" -> {calls_str}" if calls_str else ""
        lines.append(f"  {vis}{label}() {line_range}{suffix}")

        # Show docstring first line if available
        doc = docstrings.get(label, "")
        if doc:
            first_line = doc.strip().split("\n")[0][:100]
            if first_line:
                lines.append(f"    # {first_line}")

    # ── non-function symbols (classes, methods) ───────────────────────────────
    non_funcs = [sd for sd in symdefs if sd.get("kind") != "function"]
    if non_funcs:
        lines.extend(["", "Class/method symbols:"])
        for sd in non_funcs:
            kind       = sd.get("kind", "?")
            name       = sd.get("name", "?")
            parent     = sd.get("parent")
            bases      = sd.get("bases", []) or []
            line_r     = f"L{sd.get('line')}-{sd.get('end_line')}"
            pub        = "+" if sd.get("is_public") else ""
            parent_str = f"  (in {parent})" if parent else ""
            bases_str  = f"({', '.join(bases)})" if bases else ""
            lines.append(f"  {pub}{kind} {name}{bases_str} [{line_r}]{parent_str}")

    return "\n".join(lines)


def _tool_l3(file_key: str, modules: dict) -> str:
    """L3: detailed symbol browser for a single file."""
    import os.path

    if file_key not in modules:
        candidates = [k for k in modules if file_key.lower() in k.lower()]
        if not candidates:
            return (
                f"File not found: {file_key!r}\n"
                "Tip: use vizcode_l1(module) to list exact file paths."
            )
        exact = [c for c in candidates
                 if os.path.basename(c).lower() == file_key.lower()]
        file_key = (exact or candidates)[0]

    m = modules[file_key]
    symdefs = m.get("symdefs", []) or []
    funcdefs = m.get("funcdefs", []) or []
    func_calls = m.get("func_calls_by_func", []) or []
    extras = m.get("extras") or {}
    docstrings = extras.get("docstrings", {}) if isinstance(extras, dict) else {}

    lines = [
        f"=== {file_key} (L3) ===",
        f"{len(symdefs)} symbols | detailed symbol browser",
    ]

    if isinstance(extras, dict) and extras.get("file_error"):
        lines.extend(["", "Parse notes:", f"  {extras.get('file_error')}"])

    if not symdefs:
        lines.extend(["", "No symbols were extracted for this file."])
        return "\n".join(lines)

    by_name: dict[str, dict] = {}
    by_parent: dict[str, list] = {}
    top_level: list = []
    for sd in symdefs:
        name = sd.get("name", "")
        if name and name not in by_name:
            by_name[name] = sd
        parent = sd.get("parent")
        if parent:
            by_parent.setdefault(parent, []).append(sd)
        else:
            top_level.append(sd)

    lines.extend(["", "Symbols:"])
    ordered = sorted(top_level, key=lambda s: (s.get("line", 0), s.get("name", "")))
    for sd in ordered[:80]:
        kind = sd.get("kind", "?")
        name = sd.get("name", "?")
        bases = sd.get("bases", []) or []
        line_r = f"L{sd.get('line')}-{sd.get('end_line')}"
        sig = sd.get("signature") or ""
        decos = sd.get("decorators") or []
        vis = "+" if sd.get("is_public", True) else "-"
        bases_str = f"({', '.join(bases)})" if bases else ""
        sig_str = f" {sig}" if sig else ""
        deco_str = f" @{', @'.join(decos)}" if decos else ""
        lines.append(f"  {vis}{kind} {name}{bases_str}{sig_str} [{line_r}]{deco_str}")

        members = sorted(by_parent.get(name, []), key=lambda s: (s.get("line", 0), s.get("name", "")))
        for child in members[:20]:
            c_kind = child.get("kind", "?")
            c_name = child.get("name", "?")
            c_line = f"L{child.get('line')}-{child.get('end_line')}"
            c_sig = child.get("signature") or ""
            c_sig_str = f" {c_sig}" if c_sig else ""
            c_vis = "+" if child.get("is_public", True) else "-"
            lines.append(f"    {c_vis}{c_kind} {c_name}{c_sig_str} [{c_line}]")
        if len(members) > 20:
            lines.append(f"    ...+{len(members) - 20} more members")

    if len(top_level) > 80:
        lines.append(f"  ...+{len(top_level) - 80} more top-level symbols")

    orphan_members = [
        s for s in symdefs
        if s.get("parent") and s.get("parent") not in by_name
    ]
    if orphan_members:
        lines.extend(["", "External or unresolved parents:"])
        for sd in orphan_members[:30]:
            lines.append(
                f"  {sd.get('kind', '?')} {sd.get('name', '?')} "
                f"(parent: {sd.get('parent')})"
            )

    relationships: list[str] = []
    for sd in symdefs:
        src = sd.get("name", "")
        for base in sd.get("bases", []) or []:
            if src and base:
                relationships.append(f"  {src} --inheritance/implements--> {base}")

    labels = [
        fd.get("label") if isinstance(fd, dict) else str(fd)
        for fd in funcdefs
    ]
    for idx, label in enumerate(labels):
        calls = func_calls[idx] if idx < len(func_calls) else []
        for callee in dict.fromkeys(calls):
            if callee in by_name:
                relationships.append(f"  {label} --call--> {callee}")

    if relationships:
        lines.extend(["", "Symbol relationships:"])
        lines.extend(relationships[:80])
        if len(relationships) > 80:
            lines.append(f"  ...+{len(relationships) - 80} more relationships")

    docs = []
    for sd in symdefs:
        name = sd.get("name", "")
        doc = sd.get("doc") or docstrings.get(name, "")
        if doc:
            first = doc.strip().split("\n")[0][:120]
            if first:
                docs.append((name, first))
    if docs:
        lines.extend(["", "Docs:"])
        for name, first in docs[:20]:
            lines.append(f"  {name}: {first}")

    return "\n".join(lines)


def _tool_health(modules: dict, stem_to_key: dict) -> str:
    """Health: god files, heavy files, dead code candidates, possible circular imports."""
    # ── inbound count per file ────────────────────────────────────────────────
    inbound: dict[str, int] = {k: 0 for k in modules}
    file_imports: dict[str, set[str]] = {}
    for key, m in modules.items():
        resolved_set: set[str] = set()
        for imp in (m.get("imports") or []):
            tgt_name = _imp_name(imp)
            resolved = stem_to_key.get(tgt_name)
            if resolved and resolved != key and resolved in inbound:
                inbound[resolved] += 1
                resolved_set.add(resolved)
        file_imports[key] = resolved_set

    # ── god files (most imported) ─────────────────────────────────────────────
    god_files = [(k, cnt) for k, cnt in sorted(inbound.items(), key=lambda x: -x[1])
                 if cnt > 0][:5]

    # ── heavy files (most functions) ──────────────────────────────────────────
    heavy = [(k, len(m.get("funcdefs", []) or []))
             for k, m in modules.items()]
    heavy.sort(key=lambda x: -x[1])
    heavy = [(k, n) for k, n in heavy if n > 0][:5]

    # ── possible circular imports (direct A ↔ B pairs) ────────────────────────
    cycles: list[tuple[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for a, a_imports in file_imports.items():
        for b in a_imports:
            if a in file_imports.get(b, set()):
                pair = (min(a, b), max(a, b))
                if pair not in seen_pairs:
                    seen_pairs.add(pair)
                    cycles.append(pair)

    # ── dead function candidates ──────────────────────────────────────────────
    all_calls: set[str] = set()
    for m in modules.values():
        for c in (m.get("funccalls") or []):
            if isinstance(c, str):
                all_calls.add(c)

    _SKIP_PREFIXES = ("test_", "setup", "teardown", "__")
    _SKIP_EXACT    = {"main", "__main__", "setUp", "setUpClass", "tearDown", "tearDownClass"}

    dead_candidates: list[str] = []
    seen_dead: set[str] = set()
    for key, m in modules.items():
        # Build a decorator lookup from symdefs
        decorated: set[str] = set()
        for sd in (m.get("symdefs") or []):
            if sd.get("decorators"):
                decorated.add(sd.get("name", ""))
        for fd in (m.get("funcdefs") or []):
            label = fd.get("label", "") if isinstance(fd, dict) else str(fd)
            if not label:
                continue
            if label in _SKIP_EXACT:
                continue
            if any(label.startswith(p) for p in _SKIP_PREFIXES):
                continue
            if label in decorated:
                continue
            entry = f"{key}: {label}()"
            if label not in all_calls and entry not in seen_dead:
                seen_dead.add(entry)
                dead_candidates.append(entry)

    # ── format output ─────────────────────────────────────────────────────────
    lines = ["=== Codebase Health ===", ""]

    lines.append("God files (most imported — high coupling risk):")
    if god_files:
        for name, cnt in god_files:
            lines.append(f"  {name}  ({cnt} inbound imports)")
    else:
        lines.append("  (none — no resolved import edges)")

    lines.extend(["", "Heavy files (most functions — complexity candidates):"])
    if heavy:
        for name, cnt in heavy:
            lines.append(f"  {name}  ({cnt} functions)")
    else:
        lines.append("  (none)")

    lines.extend(["", "Possible circular imports (direct A \u21d4 B):"])
    if cycles:
        for a, b in sorted(cycles)[:10]:
            lines.append(f"  {a}  <->  {b}")
        if len(cycles) > 10:
            lines.append(f"  ...+{len(cycles) - 10} more pairs")
    else:
        lines.append("  (none detected)")

    lines.extend(["", f"Dead function candidates ({len(dead_candidates)} found):"])
    lines.append("  Note: excludes __dunder__, test_*, decorated, and main functions.")
    lines.append("  Still may include entry points or dynamically-called functions.")
    if dead_candidates:
        for dc in sorted(dead_candidates)[:20]:
            lines.append(f"  {dc}")
        if len(dead_candidates) > 20:
            lines.append(f"  ...+{len(dead_candidates) - 20} more")
    else:
        lines.append("  (none — all functions appear to be called somewhere)")

    return "\n".join(lines)


def _tool_query(question: str, modules: dict, edges: list, symidx: Optional[dict] = None) -> str:
    """Return modules and semantic edges matching keywords in the question.

    When `symidx` is supplied, keyword ties are broken by file centrality so the
    most-imported (hub) modules surface first.
    """
    keywords = [w.lower() for w in question.split() if len(w) > 2]
    if not keywords:
        return "Please provide a question with at least one keyword."

    fscore = (symidx or {}).get("file_score", {})

    def _score(text: str) -> int:
        t = text.lower()
        return sum(1 for k in keywords if k in t)

    # Score each module name; break keyword-score ties by centrality.
    hits: list[tuple[int, str]] = []
    for name in modules:
        s = _score(name)
        if s:
            hits.append((s, name))
    hits.sort(key=lambda h: (h[0], fscore.get(h[1], 0.0)), reverse=True)
    top_modules = {name for _, name in hits[:8]}

    # Score semantic edges by reason + module names
    sem_hits = []
    for e in edges:
        if e["kind"] != "inferred":
            continue
        s = _score(e["source"]) + _score(e["target"]) + _score(e["reason"])
        if s:
            sem_hits.append((s, e))
    sem_hits.sort(reverse=True, key=lambda x: x[0])

    lines = []
    notice = _semantic_notice(edges)
    if notice:
        lines.append("Note: " + notice)
    if top_modules:
        lines.append("Matching modules:")
        for _, name in hits[:8]:
            lines.append(f"  {name}")

    if sem_hits:
        lines.append("\nSemantic relationships:")
        for _, e in sem_hits[:10]:
            conf = f"({e['confidence']:.2f})" if e["confidence"] else ""
            tag = f"[{e['label']}] " if e.get("label") else ""
            lines.append(f"  {tag}{e['source']} → {e['target']} {conf}")
            if e["reason"]:
                lines.append(f"    reason: {e['reason']}")

    if not lines:
        return f"No modules or relationships found matching: {question}"
    return "\n".join(lines)


def _tool_path(source: str, target: str, modules: dict, adj: dict) -> str:
    """BFS shortest path from source to target module."""
    if source not in modules:
        return f"Module not found: {source}"
    if target not in modules:
        return f"Module not found: {target}"
    if source == target:
        return json.dumps([source])

    visited = {source}
    queue: deque[list[str]] = deque([[source]])
    while queue:
        path = queue.popleft()
        node = path[-1]
        for nb in adj.get(node, []):
            if nb == target:
                result = path + [nb]
                return json.dumps(result)
            if nb not in visited:
                visited.add(nb)
                queue.append(path + [nb])

    return f"No dependency path found between {source} and {target}"


def _tool_explain(symbol: str, modules: dict, edges: list) -> str:
    """Explain a module: role summary + direct connections."""
    if symbol not in modules:
        # fuzzy match
        candidates = [n for n in modules if symbol.lower() in n.lower()]
        if not candidates:
            return f"Module not found: {symbol}"
        symbol = candidates[0]

    m = modules[symbol]
    funcdefs = m.get("funcdefs", [])
    imports = m.get("imports", [])

    # Collect semantic reason for this module (as source or target)
    sem_roles = []
    for e in edges:
        if e["kind"] != "inferred":
            continue
        if e["source"] == symbol or e["target"] == symbol:
            sem_roles.append(e)

    # Direct static neighbours
    direct_out = [e["target"] for e in edges if e["source"] == symbol and e["target"] in modules]
    direct_in  = [e["source"] for e in edges if e["target"] == symbol and e["source"] in modules]

    lines = [f"=== {symbol} ==="]

    # Semantic role from inferred edges
    if sem_roles:
        lines.append("\nSemantic role:")
        shown = set()
        for e in sem_roles[:4]:
            key = (e["source"], e["target"])
            if key not in shown and e["reason"]:
                tag = f"[{e['label']}] " if e.get("label") else ""
                lines.append(f"  {tag}{e['reason']}")
                shown.add(key)

    # Function definitions (up to 10)
    if funcdefs:
        func_names = []
        for f in funcdefs[:10]:
            if isinstance(f, dict):
                func_names.append(f.get("label", str(f)))
            else:
                func_names.append(str(f))
        lines.append(f"\nFunctions ({len(funcdefs)} total): {', '.join(func_names)}")

    # Direct connections
    if direct_out:
        lines.append(f"\nImports/calls: {', '.join(direct_out[:10])}")
    if direct_in:
        lines.append(f"Used by: {', '.join(direct_in[:10])}")

    return "\n".join(lines)


# ─── Adaptive output budgets ──────────────────────────────────────────────────

_BASE_TOOL_BUDGETS: dict = {
    "vizcode_path":    2_000,
    "vizcode_query":   4_000,
    "vizcode_explain": 4_000,
    "vizcode_report":  6_000,
    "vizcode_l0":      5_000,
    "vizcode_l1":      5_000,
    "vizcode_l2":      6_000,
    "vizcode_l3":      7_000,
    "vizcode_health":  5_000,
    "vizcode_context": 6_000,
    "vizcode_trace":   4_000,
    "vizcode_affected": 4_000,
}
_DEFAULT_TOOL_BUDGET = 5_000


def _budget_for_filecount(n_files: int) -> dict:
    """Scale per-tool char budgets to repo size.

    Small/medium repos keep today's caps (factor 1.0) so behaviour and existing
    tests are unchanged; only large repos get bigger single-call payloads, which
    saves the LLM extra drill-down round-trips on big codebases.
    """
    if n_files < 1500:
        factor = 1.0
    elif n_files < 6000:
        factor = 1.5
    else:
        factor = 2.0
    return {k: int(v * factor) for k, v in _BASE_TOOL_BUDGETS.items()}


def _budget_clamp(text: str, char_budget: int) -> str:
    if char_budget <= 0 or len(text) <= char_budget:
        return text
    return (text[:char_budget].rstrip()
            + f"\n\n[output truncated to {char_budget} chars; narrow the question, lower node_cap, "
              "add relation_filter, or use a file/symbol-specific tool for full detail]")


# ─── Smart-context helpers ────────────────────────────────────────────────────

_STOPWORDS = frozenset({
    "the", "and", "for", "how", "does", "do", "what", "which", "where", "when",
    "who", "why", "is", "are", "was", "were", "to", "of", "in", "on", "at", "by",
    "a", "an", "with", "that", "this", "from", "show", "me", "explain", "can",
    "you", "it", "its", "into", "get", "got", "reach", "reaches", "call", "calls",
    "flow", "flows", "connect", "connects", "between", "use", "uses", "used",
    "work", "works", "about", "there", "their", "them", "then", "than", "code",
    "file", "files", "function", "functions", "class", "module", "modules",
})

_CALL_RELATIONS = {"call", "calls", "caller", "callers"}
_IMPORT_RELATIONS = {"import", "imports", "include", "dependency", "dependencies"}


def _normalise_relation_filter(values) -> set[str]:
    if values is None:
        return set()
    if isinstance(values, str):
        values = [values]
    out: set[str] = set()
    for v in values:
        if not isinstance(v, str):
            continue
        raw = v.strip().lower()
        if not raw:
            continue
        out.add(raw)
        if raw.endswith("s"):
            out.add(raw[:-1])
    return out


def _allows_relation(filters: set[str], *names: str) -> bool:
    return not filters or any(n in filters for n in names)


def _resolve_file(file_key: str, modules: dict) -> Optional[str]:
    """Resolve a possibly-partial file key to an exact module key (fuzzy, like _tool_l2)."""
    import os.path
    if file_key in modules:
        return file_key
    candidates = [k for k in modules if file_key.lower() in k.lower()]
    if not candidates:
        return None
    exact = [c for c in candidates if os.path.basename(c).lower() == file_key.lower()]
    return (exact or candidates)[0]


def _extract_tokens(question: str) -> list:
    """Pull candidate symbol/file tokens out of a natural-language question."""
    raw: list = []
    raw.extend(re.findall(r"['\"`]([^'\"`]+)['\"`]", question))            # quoted spans first
    for w in re.findall(r"[A-Za-z_][A-Za-z0-9_./]*", question):           # identifiers + paths
        raw.append(w)
        for part in re.split(r"[./]", w):
            if part:
                raw.append(part)
    out: list = []
    seen: set = set()
    for t in raw:
        t = t.strip()
        if len(t) < 3 or t.lower() in _STOPWORDS or t.lower() in seen:
            continue
        seen.add(t.lower())
        out.append(t)
    return out


def _is_strong_token(t: str) -> bool:
    """A distinctive identifier (CamelCase / snake_case / path / long) — high seed confidence.

    Generic short lowercase words ('loop', 'drive', 'post') are weak: they often collide
    with unrelated symbol/file names, so they only seed when no strong token resolved.
    """
    return ("_" in t) or ("/" in t) or ("." in t) or any(c.isupper() for c in t[1:]) or len(t) >= 8


def _fuzzy_file_seed(token: str, modules: dict) -> Optional[str]:
    """Match a token to a file by basename stem: exact stem first, then stem-prefix (len>=4).

    Stricter than _resolve_file's arbitrary-substring match, to avoid 'drive' matching
    'tmp_verify_driver.py' or 'tool' matching 'ui_tools.py'.
    """
    import os.path
    tl = token.lower()
    prefix_hit = None
    for k in modules:
        stem = os.path.splitext(os.path.basename(k))[0].lower()
        if stem == tl:
            return k
        if prefix_hit is None and len(tl) >= 4 and stem.startswith(tl):
            prefix_hit = k
    return prefix_hit


def _resolve_seeds(tokens, modules, stem_to_key, symidx):
    """Resolve question tokens to seed symbols / files. Returns (syms, files, notes).

    Strong (distinctive) tokens are resolved first; weak generic words are used only when
    no strong token matched, so common words don't drown out the real subject.
    """
    defs = symidx.get("defs", {})
    file_indeg = symidx.get("file_indeg", {})
    seed_syms: list = []
    seed_files: list = []
    seen_sym: set = set()
    seen_file: set = set()
    notes: list = []

    def _add_file(fk: str) -> None:
        if fk and fk not in seen_file:
            seen_file.add(fk); seed_files.append(fk)

    def _exact_file(t: str) -> Optional[str]:
        # exact file key or exact base/full stem (high confidence even for short words)
        return t if t in modules else stem_to_key.get(t)

    def _try_full(t: str) -> None:
        # 1. exact file key or stem -> a file seed
        fk = _exact_file(t)
        if fk:
            _add_file(fk); return
        # 2. a defined symbol name -> a symbol seed (pick most-central site)
        sites = defs.get(t)
        if sites:
            best = max(sites, key=lambda s: file_indeg.get(s["file"], 0))
            key = (best["file"], t)
            if key not in seen_sym:
                seen_sym.add(key); seed_syms.append(key)
                if len(sites) > 1:
                    notes.append(
                        f"'{t}' defined in {len(sites)} files; showing most central ({best['file']}).")
            return
        # 3. fuzzy basename-stem file match
        _add_file(_fuzzy_file_seed(t, modules))

    # Pass 1: strong tokens get full resolution (symbol or file).
    for t in tokens:
        if _is_strong_token(t):
            _try_full(t)
    # Pass 2: weak tokens may still seed via an EXACT file-stem match (e.g. 'server',
    # 'main') — high confidence — but never create symbol seeds (avoids 'loop' noise).
    for t in tokens:
        if not _is_strong_token(t):
            _add_file(_exact_file(t))
    # Pass 3: last resort — nothing resolved — let weak tokens resolve fully.
    if not seed_syms and not seed_files:
        for t in tokens:
            if not _is_strong_token(t):
                _try_full(t)
    return seed_syms, seed_files, notes


def _render_sym(fkey, name, symidx, *, max_edges: int = 4,
                relation_filter: set[str] | None = None) -> str:
    """Render one symbol compactly: location, signature, first-line doc, key edges. No body."""
    relation_filter = relation_filter or set()
    sites = symidx.get("defs", {}).get(name, [])
    sd = next((s for s in sites if s["file"] == fkey), sites[0] if sites else None)
    out: list = []
    if sd:
        vis = "+" if sd.get("is_public", True) else "-"
        sig = sd.get("signature") or ""
        out.append(f"  {fkey}:{sd.get('line')}  {vis}{sd.get('kind', '?')} {name}{(' ' + sig) if sig else ''}")
        doc = (sd.get("doc") or "").strip().split("\n")[0][:100]
        if doc:
            out.append(f"      # {doc}")
    else:
        out.append(f"  {fkey}  {name}")
    sym_score = symidx.get("sym_score", {})
    callees = sorted(symidx.get("callees", {}).get((fkey, name), set()),
                     key=lambda n: -sym_score.get(n, 0.0))
    callers = sorted(symidx.get("callers", {}).get((fkey, name), set()),
                     key=lambda n: -sym_score.get(n, 0.0))
    if _allows_relation(relation_filter, *_CALL_RELATIONS):
        if callees:
            out.append("      -> calls: " + ", ".join(n[1] for n in callees[:max_edges]))
        if callers:
            out.append("      <- callers: " + ", ".join(n[1] for n in callers[:max_edges]))
    return "\n".join(out)


def _select_subgraph(seed_syms, seed_files, modules, symidx, node_cap,
                     relation_filter: set[str] | None = None):
    """Seeds + each seed file's most-central symbol + one-hop centrality-ranked neighbours."""
    relation_filter = relation_filter or set()
    sym_score = symidx.get("sym_score", {})
    callees = symidx.get("callees", {})
    callers = symidx.get("callers", {})
    selected: list = []
    seen: set = set()

    def _add(node):
        if node not in seen:
            seen.add(node); selected.append(node)

    for s in seed_syms:
        _add(s)
    for f in seed_files:
        m = modules.get(f, {})
        best = None; best_sc = -1.0
        for sd in (m.get("symdefs") or []):
            nm = sd.get("name", "")
            sc = sym_score.get((f, nm), 0.0)
            if nm and sc > best_sc:
                best = (f, nm); best_sc = sc
        if best is None:
            for fd in (m.get("funcdefs") or []):
                lbl = fd.get("label") if isinstance(fd, dict) else str(fd)
                if lbl:
                    best = (f, lbl); break
        if best:
            _add(best)

    if _allows_relation(relation_filter, *_CALL_RELATIONS):
        neighbours: list = []
        for node in list(selected):
            for nb in list(callees.get(node, set())) + list(callers.get(node, set())):
                neighbours.append(nb)
        neighbours.sort(key=lambda n: -sym_score.get(n, 0.0))
        for nb in neighbours:
            if len(selected) >= node_cap:
                break
            _add(nb)
    return selected[:node_cap]


_FLOW_RE = re.compile(
    r"\bhow\b.*\b(reach|reaches|call|calls|get\s+to|flow|flows|connect|connects|"
    r"lead|leads|trigger|triggers|invoke|invokes)\b", re.I)


def _is_flow_question(question, seed_syms, seed_files) -> bool:
    if _FLOW_RE.search(question):
        return True
    files = set(seed_files) | {f for (f, _) in seed_syms}
    return len(files) >= 2


def _flow_endpoints(seed_syms, seed_files):
    ordered: list = []
    for f in seed_files:
        if f not in ordered:
            ordered.append(f)
    for (f, _) in seed_syms:
        if f not in ordered:
            ordered.append(f)
    src = ordered[0] if ordered else None
    tgt = ordered[1] if len(ordered) >= 2 else None
    return src, tgt


def _most_central_symbol(fkey, m, symidx):
    """Return (name, symdef) for the file's most-central symbol, or None."""
    sym_score = symidx.get("sym_score", {})
    best = None; best_sd = None; best_sc = -1.0
    for sd in (m.get("symdefs") or []):
        nm = sd.get("name", "")
        if not nm:
            continue
        sc = sym_score.get((fkey, nm), 0.0)
        if sc > best_sc:
            best = nm; best_sd = sd; best_sc = sc
    if best is None:
        for fd in (m.get("funcdefs") or []):
            lbl = fd.get("label") if isinstance(fd, dict) else str(fd)
            if lbl:
                sd = next((s for s in (m.get("symdefs") or []) if s.get("name") == lbl), None)
                return lbl, (sd or {"name": lbl})
        return None
    return best, best_sd


def _link_symbol(src_file, tgt_file, modules, symidx) -> str:
    """Find the funcdef->callee pair in src_file whose callee is defined in tgt_file."""
    m = modules.get(src_file, {})
    funcdefs = m.get("funcdefs") or []
    fcbf = m.get("func_calls_by_func") or []
    defs = symidx.get("defs", {})
    for i, fd in enumerate(funcdefs):
        lbl = fd.get("label") if isinstance(fd, dict) else str(fd)
        calls = fcbf[i] if i < len(fcbf) else []
        for c in calls:
            if not isinstance(c, str):
                continue
            sites = defs.get(c)
            if sites and any(s["file"] == tgt_file for s in sites):
                return f"{lbl}() -> {c}()"
    return "import edge"


def _trace_between(source, target, modules, adj, stem_to_key, symidx,
                   *, max_hops: int = 8, char_budget: int = 4000) -> str:
    """BFS dependency path source->target with per-hop signature/doc + linking symbol.

    Shared core used by both _tool_trace and _tool_context's flow-inline section.
    """
    s = _resolve_file(source, modules)
    t = _resolve_file(target, modules)
    if not s:
        return f"Source file not found: {source!r}"
    if not t:
        return f"Target file not found: {target!r}"
    if s == t:
        return f"Source and target are the same file: {s}"

    # Prefer the resolved file adjacency (stem-resolved) over the sparse raw adj.
    adjacency = symidx.get("file_adj") or adj

    visited = {s}
    queue: deque = deque([[s]])
    path = None
    while queue:
        p = queue.popleft()
        if len(p) > max_hops + 1:
            continue
        node = p[-1]
        done = False
        for nb in adjacency.get(node, []):
            if nb == t:
                path = p + [nb]; done = True; break
            if nb not in visited:
                visited.add(nb); queue.append(p + [nb])
        if done:
            break
    if not path:
        return f"No dependency path found between {s} and {t}."

    lines = [f"=== Trace: {s} -> {t} ===", f"{len(path)} files on path"]
    for idx, fkey in enumerate(path):
        m = modules.get(fkey, {})
        best = _most_central_symbol(fkey, m, symidx)
        if best:
            nm, sd = best
            sig = sd.get("signature") or ""
            lines.append(f"  [{idx}] {fkey}:{sd.get('line')}  {nm}{(' ' + sig) if sig else ''}")
            doc = (sd.get("doc") or "").strip().split("\n")[0][:80]
            if doc:
                lines.append(f"        # {doc}")
        else:
            lines.append(f"  [{idx}] {fkey}")
        if idx + 1 < len(path):
            lines.append(f"        linked via: {_link_symbol(fkey, path[idx + 1], modules, symidx)}")
    return _budget_clamp("\n".join(lines), char_budget)


def _tool_trace(source, target, modules, adj, stem_to_key, symidx,
                *, max_hops: int = 8, char_budget: int = 4000) -> str:
    """Tool wrapper around _trace_between (inline-code dependency trace)."""
    return _trace_between(source, target, modules, adj, stem_to_key, symidx,
                          max_hops=max_hops, char_budget=char_budget)


def _tool_affected(target: str, modules, stem_to_key, symidx,
                   *, depth: int = 2, relation_filter=None,
                   char_budget: int = 4000) -> str:
    """Reverse traversal from a file/symbol to likely affected callers/importers."""
    try:
        depth = max(1, min(int(depth), 6))
    except (TypeError, ValueError):
        depth = 2
    filters = _normalise_relation_filter(relation_filter)
    tokens = _extract_tokens(target)
    if target and target not in tokens:
        tokens.insert(0, target)
    seed_syms, seed_files, notes = _resolve_seeds(tokens, modules, stem_to_key, symidx)
    if not seed_syms and not seed_files:
        return f"No file or symbol matched: {target}"

    allow_calls = _allows_relation(filters, *_CALL_RELATIONS)
    allow_imports = _allows_relation(filters, *_IMPORT_RELATIONS)
    callers = symidx.get("callers", {})
    file_importers = symidx.get("file_importers", {})

    lines = ["=== Affected ==="]
    if filters:
        lines.append("Relation filter: " + ", ".join(sorted(filters)))
    for n in notes[:3]:
        lines.append(f"note: {n}")

    seen_syms: set = set(seed_syms)
    seen_files: set = set(seed_files)
    q: deque = deque()
    for s in seed_syms:
        q.append(("sym", s, 0, "seed"))
    for f in seed_files:
        q.append(("file", f, 0, "seed"))

    hits: list[tuple[int, str, str, object]] = []
    while q:
        kind, node, d, via = q.popleft()
        if d >= depth:
            continue
        if kind == "sym" and allow_calls:
            for nb in sorted(callers.get(node, set())):
                if nb in seen_syms:
                    continue
                seen_syms.add(nb)
                hits.append((d + 1, "call", via, nb))
                q.append(("sym", nb, d + 1, "call"))
        elif kind == "file" and allow_imports:
            for nb in sorted(file_importers.get(node, [])):
                if nb in seen_files:
                    continue
                seen_files.add(nb)
                hits.append((d + 1, "import", via, nb))
                q.append(("file", nb, d + 1, "import"))

    if seed_syms:
        lines.append("Seed symbols: " + ", ".join(f"{f}::{n}" for f, n in seed_syms[:6]))
    if seed_files:
        lines.append("Seed files: " + ", ".join(seed_files[:6]))
    lines.append(f"Depth: {depth}")

    if not hits:
        lines.append("No affected callers or importers found.")
        return _budget_clamp("\n".join(lines), char_budget)

    lines.append("Likely affected:")
    for d, rel, _via, node in hits[:40]:
        if rel == "call":
            f, n = node
            lines.append(f"  d{d} call    {f}::{n}")
        else:
            lines.append(f"  d{d} import  {node}")
    if len(hits) > 40:
        lines.append(f"  ...+{len(hits) - 40} more; narrow relation_filter or depth")
    return _budget_clamp("\n".join(lines), char_budget)


def _tool_context(question, modules, mod_to_files, stem_to_key, symidx, edges, adj,
                  *, node_cap: int = 12, char_budget: int = 6000,
                  relation_filter=None, mode: str = "broad") -> str:
    """One-shot smart context: resolve seeds from the question, assemble a compact
    centrality-ranked subgraph (signatures + first-line docs + key edges, never raw
    bodies), and inline a trace for flow questions — answering most questions in one
    call instead of a manual l0->l1->l2->l3 drilldown.
    """
    filters = _normalise_relation_filter(relation_filter)
    try:
        node_cap = max(1, min(int(node_cap), 50))
    except (TypeError, ValueError):
        node_cap = 12

    tokens = _extract_tokens(question)
    seed_syms, seed_files, notes = _resolve_seeds(tokens, modules, stem_to_key, symidx)

    if not seed_syms and not seed_files:
        # nothing resolved -> keyword fallback so a single call is always useful
        kw = _tool_query(question, modules, edges, symidx)
        return _budget_clamp(
            "=== Context (keyword fallback) ===\n"
            "No specific symbol/file matched the question; showing keyword matches.\n\n"
            + kw, char_budget)

    nodes = _select_subgraph(seed_syms, seed_files, modules, symidx, node_cap, filters)
    mode = (mode or "broad").lower()
    flow = mode == "trace" or _is_flow_question(question, seed_syms, seed_files)

    header = ["=== Context ===",
              f"{len(seed_syms)} seed symbols | {len(seed_files)} seed files | "
              f"up to {len(nodes)} nodes"]
    if filters:
        header.append("Relation filter: " + ", ".join(sorted(filters)))
    notice = _semantic_notice(edges)
    if notice:
        header.append("note: " + notice)
    for n in notes[:3]:
        header.append(f"note: {n}")
    if seed_files:
        header.append("Seed files: " + ", ".join(seed_files[:6]))
    header.append("")
    header.append("Relevant symbols (centrality-ranked):")

    # reserve room for the trace section when this is a flow question
    reserve = 1600 if flow else 0
    soft = max(1000, char_budget - reserve)

    body: list = []
    used = sum(len(h) + 1 for h in header)
    shown = 0
    for (f, nm) in nodes:
        r = _render_sym(f, nm, symidx, relation_filter=filters)
        if used + len(r) > soft and body:
            body.append(f"  ...+{len(nodes) - shown} more symbols omitted (budget)")
            break
        body.append(r); used += len(r) + 1; shown += 1

    text = "\n".join(header + body)

    if flow:
        s, t = _flow_endpoints(seed_syms, seed_files)
        if s and t and s != t:
            trace = _trace_between(s, t, modules, adj, stem_to_key, symidx,
                                   char_budget=(reserve - 100 if reserve > 200 else 1200))
            text = text + "\n\n" + trace

    return _budget_clamp(text, char_budget)


# ─── Tool registry ────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "vizcode_context",
        "description": (
            "PREFER THIS FIRST for almost any question about the code. "
            "Give a natural-language question; returns a compact, centrality-ranked "
            "subgraph of the most relevant symbols (signatures + first-line docs + key "
            "call edges) in ONE call — no manual vizcode_l0 -> l1 -> l2 -> l3 drilldown "
            "needed. For 'how does X reach Y' questions it also inlines a call/dependency "
            "trace. Returns summaries and signatures, never raw source bodies."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "Natural-language question; may name files, functions, or classes.",
                },
                "relation_filter": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional relation names such as call or import to narrow context.",
                },
                "mode": {
                    "type": "string",
                    "enum": ["broad", "trace"],
                    "default": "broad",
                    "description": "Use trace to force path context when source and target are both present.",
                },
                "node_cap": {
                    "type": "integer",
                    "default": 12,
                    "description": "Maximum relevant symbols to render, clamped to 1-50.",
                },
            },
            "required": ["question"],
        },
    },
    {
        "name": "vizcode_trace",
        "description": (
            "Trace the dependency/call path between two files and inline, for each hop, "
            "the linking function plus that hop's key signature and first-line doc. "
            "Use for 'how does A reach B' / 'what connects X and Y'. "
            "More detailed than vizcode_path (which returns only a bare path array)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Source file path (as shown by vizcode_l1)."},
                "target": {"type": "string", "description": "Target file path."},
            },
            "required": ["source", "target"],
        },
    },
    {
        "name": "vizcode_affected",
        "description": (
            "Find likely callers or importers affected by changing a file or symbol. "
            "Uses reverse graph traversal with a small depth instead of broad scans."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "File path, class, or function name."},
                "depth": {"type": "integer", "default": 2, "description": "Reverse traversal depth, 1-6."},
                "relation_filter": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional relation names such as call or import.",
                },
            },
            "required": ["target"],
        },
    },
    {
        "name": "vizcode_query",
        "description": (
            "Search for modules and semantic relationships matching a question. "
            "Returns a summary of relevant modules and inferred edges with reasons."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Natural-language question about the codebase"}
            },
            "required": ["question"],
        },
    },
    {
        "name": "vizcode_path",
        "description": (
            "Find the shortest dependency path between two modules. "
            "Returns a JSON array of module names, e.g. [\"server.py\", \"analyze_viz.py\", \"python_parser.py\"]."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Starting module filename"},
                "target": {"type": "string", "description": "Target module filename"},
            },
            "required": ["source", "target"],
        },
    },
    {
        "name": "vizcode_explain",
        "description": (
            "Explain what a module does: its semantic role, exported functions, "
            "and direct connections. Does not return raw source code."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Module filename to explain"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "vizcode_report",
        "description": (
            "Return the full codebase Markdown report: scan overview, module dependency tree, "
            "hotspot nodes, surprising connections, health metrics. "
            "Call this first before deeper analysis to orient yourself and save context tokens."
        ),
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "vizcode_l0",
        "description": (
            "Return a codebase-level module overview: top-level module groups, file counts, "
            "and inter-module dependency edges. "
            "Use this first to orient yourself before calling vizcode_l1, vizcode_l2, or vizcode_l3. "
            "~200 tokens. No parameters required."
        ),
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "vizcode_l1",
        "description": (
            "Return all files in a module and their intra-module import edges. "
            "Use vizcode_l0() first to find valid module names. "
            "Use '.' for root-level files. ~150 tokens."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "module": {
                    "type": "string",
                    "description": (
                        "Module name (top-level directory). "
                        "Use '.' for root-level files. "
                        "Examples: 'parsers', 'static', 'tests', '.'"
                    ),
                },
            },
            "required": ["module"],
        },
    },
    {
        "name": "vizcode_l2",
        "description": (
            "Return the function call graph and symbol definitions for a single file. "
            "Shows every function, its line range, visibility (+public), "
            "docstring first line (if available), and what it calls. "
            "Also shows class inheritance. More detailed than vizcode_explain. "
            "Use vizcode_l1(module) to get exact file paths first. "
            "~300-1200 tokens depending on file size."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "file": {
                    "type": "string",
                    "description": (
                        "File path as shown in vizcode_l1 output, "
                        "e.g. 'analyze_viz.py', 'parsers/python_parser.py'. "
                        "Partial names are also accepted."
                    ),
                },
            },
            "required": ["file"],
        },
    },
    {
        "name": "vizcode_l3",
        "description": (
            "Return a detailed per-file symbol browser report. Shows symbols grouped "
            "by structure, enriched symbol attributes such as signature/doc/decorators, "
            "and conservative symbol relationships derivable from scan_cache. Use after "
            "vizcode_l2(file) when you need finer structure than the call graph. "
            "~500-1500 tokens depending on file size."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "file": {
                    "type": "string",
                    "description": (
                        "File path as shown in vizcode_l1 output, "
                        "e.g. 'analyze_viz.py', 'parsers/python_parser.py'. "
                        "Partial names are also accepted."
                    ),
                },
            },
            "required": ["file"],
        },
    },
    {
        "name": "vizcode_health",
        "description": (
            "Return actionable codebase health metrics computed from AST data: "
            "god files (most imported, high coupling risk), "
            "heavy files (most functions, complexity candidates), "
            "possible circular imports (direct A\u21d4B pairs), "
            "and dead function candidates (defined but never called externally). "
            "Dead code list excludes __dunder__, test_*, decorated, and main functions "
            "but may still include entry points or dynamically-called functions. "
            "~300 tokens. No parameters required."
        ),
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
]


# ─── C4: Report tool ─────────────────────────────────────────────────────────

def _tool_report(report_path: str) -> str:
    """Return the contents of vizcode_report.md, or a hint if it is missing."""
    p = Path(report_path)
    if p.is_file():
        return p.read_text(encoding='utf-8')
    return (
        "vizcode_report.md not found.\n"
        "Run `/vizcode --parse` (or `python vizcode.py <path> --scan-only`) "
        "to generate the report first."
    )


# ─── Server loop ──────────────────────────────────────────────────────────────

def _serve(scan_path: str, sem_path: str, report_path: str) -> None:
    scan = _load_json(scan_path)
    sem  = _load_json(sem_path)
    modules, edges, adj = _build_index(scan, sem)
    mod_to_files, stem_to_key = _build_stem_index(modules)
    symidx = _build_symbol_index(modules, stem_to_key)
    budgets = _budget_for_filecount(len(modules))

    stdin  = sys.stdin.buffer
    stdout = sys.stdout.buffer
    initialized = False

    while True:
        msg = _read_message(stdin)
        if msg is None:
            break

        method = msg.get("method", "")
        req_id = msg.get("id")
        params = msg.get("params", {})

        # ── initialize ───────────────────────────────────────────────────────
        if method == "initialize":
            initialized = True
            _send_message(stdout, _ok(req_id, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "vizcode", "version": "0.3"},
            }))

        # ── notifications/initialized ─────────────────────────────────────
        elif method == "notifications/initialized":
            pass  # no response needed for notifications

        # ── tools/list ────────────────────────────────────────────────────
        elif method == "tools/list":
            _send_message(stdout, _ok(req_id, {"tools": TOOLS}))

        # ── tools/call ────────────────────────────────────────────────────
        elif method == "tools/call":
            name = params.get("name", "")
            args = params.get("arguments", {})
            budget = budgets.get(name, _DEFAULT_TOOL_BUDGET)

            if name == "vizcode_query":
                text = _tool_query(args.get("question", ""), modules, edges, symidx)
            elif name == "vizcode_path":
                text = _tool_path(args.get("source", ""), args.get("target", ""), modules, adj)
            elif name == "vizcode_context":
                text = _tool_context(
                    args.get("question", ""), modules, mod_to_files, stem_to_key,
                    symidx, edges, adj,
                    char_budget=budget,
                    relation_filter=args.get("relation_filter"),
                    mode=args.get("mode", "broad"),
                    node_cap=args.get("node_cap", 12),
                )
            elif name == "vizcode_trace":
                text = _tool_trace(
                    args.get("source", ""), args.get("target", ""), modules, adj,
                    stem_to_key, symidx,
                    char_budget=budget,
                )
            elif name == "vizcode_affected":
                text = _tool_affected(
                    args.get("target", ""), modules, stem_to_key, symidx,
                    depth=args.get("depth", 2),
                    relation_filter=args.get("relation_filter"),
                    char_budget=budget,
                )
            elif name == "vizcode_explain":
                text = _tool_explain(args.get("symbol", ""), modules, edges)
            elif name == "vizcode_report":
                text = _tool_report(report_path)
            elif name == "vizcode_l0":
                text = _tool_l0(modules, mod_to_files, stem_to_key)
            elif name == "vizcode_l1":
                text = _tool_l1(args.get("module", "."), modules, mod_to_files, stem_to_key)
            elif name == "vizcode_l2":
                text = _tool_l2(args.get("file", ""), modules)
            elif name == "vizcode_l3":
                text = _tool_l3(args.get("file", ""), modules)
            elif name == "vizcode_health":
                text = _tool_health(modules, stem_to_key)
            else:
                _send_message(stdout, _err(req_id, -32601, f"Unknown tool: {name}"))
                continue
            text = _budget_clamp(str(text), budget)

            _send_message(stdout, _ok(req_id, {
                "content": [{"type": "text", "text": text}]
            }))

        # ── unknown method ────────────────────────────────────────────────
        elif req_id is not None:
            _send_message(stdout, _err(req_id, -32601, f"Method not found: {method}"))


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog="mcp_server", description="VizCode MCP stdio server")
    parser.add_argument("--scan", default=".vizcode/scan_cache.json",
                        help="Path to scan_cache.json")
    parser.add_argument("--sem", default=".vizcode/semantic_cache.json",
                        help="Path to semantic_cache.json")
    parser.add_argument("--report", default="",
                        help="Path to vizcode_report.md (default: derived from --scan)")
    args = parser.parse_args()
    report_path = args.report or args.scan.replace("scan_cache.json", "vizcode_report.md")
    _serve(args.scan, args.sem, report_path)


if __name__ == "__main__":
    main()
