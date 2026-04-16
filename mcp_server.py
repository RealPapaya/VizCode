#!/usr/bin/env python3
"""
mcp_server.py — VizCode MCP stdio server

Implements the Model Context Protocol (MCP) over stdio (JSON-RPC 2.0,
Content-Length framing, same as LSP).

Usage:
    python mcp_server.py --scan .local/scan_cache.json \
                         --sem  .local/semantic_cache.json

Tools exposed:
    vizcode_query(question)       — keyword-match modules + semantic edges
    vizcode_path(source, target)  — shortest dependency path (BFS)
    vizcode_explain(symbol)       — module role + direct connections
    vizcode_report()              — full Markdown codebase report (token-saving overview)
"""

import argparse
import json
import sys
from collections import deque
from pathlib import Path

# ─── Wire protocol ───────────────────────────────────────────────────────────

def _read_message(stream) -> dict | None:
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


# ─── Index building ───────────────────────────────────────────────────────────

def _build_index(scan: dict, sem: dict):
    """
    Returns:
        modules  — dict[name -> payload dict]  (from scan_cache entries)
        edges    — list[{source, target, kind, confidence, reason}]
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
            tgt = imp if isinstance(imp, str) else imp.get("target", "")
            if tgt and tgt in modules:
                edges.append({"source": src_name, "target": tgt,
                               "kind": "import", "confidence": 1.0, "reason": ""})

    # Inferred edges from semantic_cache
    for e in sem.get("edges", []):
        edges.append({
            "source":     e.get("source", ""),
            "target":     e.get("target", ""),
            "kind":       "inferred",
            "confidence": e.get("confidence", 0.0),
            "reason":     e.get("reason", ""),
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

def _build_stem_index(modules: dict) -> tuple[dict, dict]:
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
            tgt_name = imp if isinstance(imp, str) else imp.get("target", "")
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
            tgt_name = imp if isinstance(imp, str) else imp.get("target", "")
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
        lines.append(f"  {f}")

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

    # ── non-function symbols (classes, methods) ───────────────────────────────
    non_funcs = [sd for sd in symdefs if sd.get("kind") != "function"]
    if non_funcs:
        lines.extend(["", "Class/method symbols:"])
        for sd in non_funcs:
            kind       = sd.get("kind", "?")
            name       = sd.get("name", "?")
            parent     = sd.get("parent")
            line_r     = f"L{sd.get('line')}-{sd.get('end_line')}"
            pub        = "+" if sd.get("is_public") else ""
            parent_str = f"  (in {parent})" if parent else ""
            lines.append(f"  {pub}{kind} {name} [{line_r}]{parent_str}")

    return "\n".join(lines)


def _tool_query(question: str, modules: dict, edges: list) -> str:
    """Return modules and semantic edges matching keywords in the question."""
    keywords = [w.lower() for w in question.split() if len(w) > 2]
    if not keywords:
        return "Please provide a question with at least one keyword."

    def _score(text: str) -> int:
        t = text.lower()
        return sum(1 for k in keywords if k in t)

    # Score each module name
    hits: list[tuple[int, str]] = []
    for name in modules:
        s = _score(name)
        if s:
            hits.append((s, name))
    hits.sort(reverse=True)
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
    if top_modules:
        lines.append("Matching modules:")
        for _, name in hits[:8]:
            lines.append(f"  {name}")

    if sem_hits:
        lines.append("\nSemantic relationships:")
        for _, e in sem_hits[:10]:
            conf = f"({e['confidence']:.2f})" if e["confidence"] else ""
            lines.append(f"  {e['source']} → {e['target']} {conf}")
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
                lines.append(f"  {e['reason']}")
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


# ─── Tool registry ────────────────────────────────────────────────────────────

TOOLS = [
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
            "Use this first to orient yourself before calling vizcode_l1 or vizcode_l2. "
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
            "and what it calls. More detailed than vizcode_explain. "
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

            if name == "vizcode_query":
                text = _tool_query(args.get("question", ""), modules, edges)
            elif name == "vizcode_path":
                text = _tool_path(args.get("source", ""), args.get("target", ""), modules, adj)
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
            else:
                _send_message(stdout, _err(req_id, -32601, f"Unknown tool: {name}"))
                continue

            _send_message(stdout, _ok(req_id, {
                "content": [{"type": "text", "text": text}]
            }))

        # ── unknown method ────────────────────────────────────────────────
        elif req_id is not None:
            _send_message(stdout, _err(req_id, -32601, f"Method not found: {method}"))


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog="mcp_server", description="VizCode MCP stdio server")
    parser.add_argument("--scan", default=".local/scan_cache.json",
                        help="Path to scan_cache.json")
    parser.add_argument("--sem", default=".local/semantic_cache.json",
                        help="Path to semantic_cache.json")
    parser.add_argument("--report", default="",
                        help="Path to vizcode_report.md (default: derived from --scan)")
    args = parser.parse_args()
    report_path = args.report or args.scan.replace("scan_cache.json", "vizcode_report.md")
    _serve(args.scan, args.sem, report_path)


if __name__ == "__main__":
    main()
