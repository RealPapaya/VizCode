#!/usr/bin/env python3
"""
edge_candidates.py — local, zero-token detector of cross-file edges AST cannot see.

Produces CANDIDATE edges only. The Claude Code skill (SKILL.md Phase 3) feeds
these to the model, which judges keep/drop + final confidence. The model therefore
*confirms* rather than *discovers* relationships, collapsing semantic-extraction
output tokens to near zero (see docs/TOKEN_ROADMAP.md, P1).

All signals are pure stdlib regex/AST over source text — no network, no model.

Signals
  subprocess  — A spawns B via subprocess/Popen/os.system/exec/spawn + a filename literal
  shared_file — A writes a data file that B reads (data coupling, neither imports the other)
  interface   — A defines a class whose base class is defined in B, but A does not import B

Candidate schema (matches semantic_enricher.write_cache after the model finalizes it):
  {"source": "<scan_cache key>", "target": "<scan_cache key>",
   "signal": "subprocess|shared_file|interface",
   "evidence": "<short source snippet>", "suggested_confidence": 0.0-1.0}

`source` / `target` are scan_cache entry keys (project-relative paths) so they match
the module keys the MCP server and graph use.

CLI:
  python edge_candidates.py <project_root>     # -> JSON array on stdout
"""

import json
import os
import re
import sys
from pathlib import Path

# ── Tunables ──────────────────────────────────────────────────────────────────
_MAX_FILE_BYTES = 600_000          # skip pathologically large files
_MAX_CANDIDATES = 250              # cap output; report truncation, never silently drop
_WINDOW = 200                      # char window around a spawn token to find a filename
_CONFIDENCE = {"subprocess": 0.80, "shared_file": 0.65, "interface": 0.85}

# Code-ish extensions a subprocess call would launch.
_SPAWN_EXT = r"py|js|mjs|cjs|ts|go|rb|sh|bash|bat|cmd|ps1|exe|jar|pl"
# Data-file extensions for shared-file coupling (NOT source — those are import edges).
_DATA_EXT = {"json", "txt", "csv", "yaml", "yml", "toml", "ini", "db", "sqlite",
             "sqlite3", "cache", "pkl", "pickle", "log", "md", "ndjson", "jsonl"}

_SPAWN_TOKENS = re.compile(
    r"subprocess\.|Popen\b|os\.system\b|os\.exec\w*\b|os\.spawn\w*\b|"
    r"check_call\b|check_output\b|\bspawn[vl]?p?e?\b|\bexec[vl]p?e?\b",
)
_FILE_LITERAL = re.compile(r"""['"]([\w./\\-]+\.(?:%s))['"]""" % _SPAWN_EXT)
_DATA_LITERAL = re.compile(r"""['"]([\w./\\-]+\.(\w+))['"]""")
_WRITE_VERB = re.compile(r"""write_text|write_bytes|\.write\b|json\.dump|\.dump\b|"""
                         r"""to_json|\bsave\b|open\([^)]*['"][^'")]*['"]\s*,\s*['"][rwa+bt]*[wa][rwa+bt]*['"]""")
_READ_VERB = re.compile(r"""read_text|read_bytes|\.read\b|json\.load|\.load\b|"""
                        r"""\bload\b|open\([^,)]*\)""")
_CLASS_KINDS = {"class", "interface", "struct", "trait", "protocol"}


# ── scan_cache loading ──────────────────────────────────────────────────────────

def _load_entries(project_root: Path) -> dict:
    """Return scan_cache 'entries' dict {relpath: {payload: {...}}}, or {}."""
    path = project_root / ".vizcode" / "scan_cache.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    entries = data.get("entries", {})
    return entries if isinstance(entries, dict) else {}


def _basename_index(keys) -> dict:
    """Map a file basename (e.g. 'server.py') -> the single key owning it.

    Ambiguous basenames (same name in two dirs) map to None so we never guess wrong.
    """
    by_base: dict = {}
    for k in keys:
        base = os.path.basename(k.replace("\\", "/"))
        if base in by_base:
            by_base[base] = None        # ambiguous — refuse to resolve
        else:
            by_base[base] = k
    return {b: k for b, k in by_base.items() if k is not None}


def _static_targets(entries: dict, base_index: dict) -> dict:
    """Best-effort set of keys each file is already statically connected to via imports.

    Used to drop candidates that AST already captures. Loose by design: a miss only
    leaks a candidate the model will discard, never a wrong edge into the graph.
    """
    stems = {}  # stem (no ext) -> key
    for k in entries:
        kk = k.replace("\\", "/")
        stems.setdefault(os.path.splitext(os.path.basename(kk))[0], kk)
    out: dict = {}
    for k, entry in entries.items():
        connected = set()
        for imp in entry.get("payload", {}).get("imports", []) or []:
            tail = str(imp).replace(".", "/").rsplit("/", 1)[-1]
            if tail in stems:
                connected.add(stems[tail])
        out[k.replace("\\", "/")] = connected
    return out


def _class_def_index(entries: dict) -> dict:
    """Map class-like symbol name -> set of keys that define it."""
    idx: dict = {}
    for k, entry in entries.items():
        kk = k.replace("\\", "/")
        for sym in entry.get("payload", {}).get("symdefs", []) or []:
            if isinstance(sym, dict) and sym.get("kind") in _CLASS_KINDS:
                name = sym.get("name")
                if name:
                    idx.setdefault(name, set()).add(kk)
    return idx


# ── source reading ──────────────────────────────────────────────────────────────

def _read_source(project_root: Path, key: str) -> str:
    p = project_root / key
    try:
        if not p.is_file() or p.stat().st_size > _MAX_FILE_BYTES:
            return ""
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def _distinctive(name: str) -> bool:
    return len(name) >= 5 and any(ch in name for ch in "._-/")


# ── signal detectors ─────────────────────────────────────────────────────────────

def _detect_subprocess(key, text, base_index, static):
    out = []
    for m in _SPAWN_TOKENS.finditer(text):
        window = text[m.start(): m.start() + _WINDOW]
        for fm in _FILE_LITERAL.finditer(window):
            tgt = base_index.get(os.path.basename(fm.group(1).replace("\\", "/")))
            if tgt and tgt != key and tgt not in static.get(key, ()):
                out.append((key, tgt, "subprocess",
                            _snippet(text, m.start())))
    return out


def _scan_shared_file(key, text):
    """Return (writes, reads): distinctive data-file basenames this file writes / reads.

    Scans around each data-file literal (both directions) for a write/read verb —
    paths are usually built near, not inside, the I/O call, so we centre on the literal.
    """
    writes, reads = set(), set()
    for dm in _DATA_LITERAL.finditer(text):
        if dm.group(2).lower() not in _DATA_EXT:
            continue
        base = os.path.basename(dm.group(1).replace("\\", "/"))
        if not _distinctive(base):
            continue
        ctx = text[max(0, dm.start() - _WINDOW): dm.end() + _WINDOW]
        if _WRITE_VERB.search(ctx):
            writes.add(base)
        if _READ_VERB.search(ctx):
            reads.add(base)
    return writes, reads


def _detect_interface(key, entry, class_idx, static):
    out = []
    payload = entry.get("payload", {})
    own = {s.get("name") for s in payload.get("symdefs", []) or []
           if isinstance(s, dict) and s.get("kind") in _CLASS_KINDS}
    for sym in payload.get("symdefs", []) or []:
        if not isinstance(sym, dict) or sym.get("kind") not in _CLASS_KINDS:
            continue
        for base in sym.get("bases", []) or []:
            base = str(base).rsplit(".", 1)[-1].strip()
            if not base or base in own:
                continue
            for tgt in class_idx.get(base, ()):  # keys defining the base
                if tgt != key and tgt not in static.get(key, ()):
                    out.append((key, tgt, "interface",
                                f"class {sym.get('name')}({base})"))
    return out


def _snippet(text: str, pos: int) -> str:
    seg = text[pos: pos + 120].splitlines()[0] if pos < len(text) else ""
    return re.sub(r"\s+", " ", seg).strip()[:120]


# ── orchestration ────────────────────────────────────────────────────────────────

def find_candidates(project_root) -> list:
    """Return a deduped, deterministic list of candidate edge dicts."""
    project_root = Path(project_root)
    entries = _load_entries(project_root)
    if not entries:
        return []

    keys = [k.replace("\\", "/") for k in entries]
    base_index = _basename_index(keys)
    static = _static_targets(entries, base_index)
    class_idx = _class_def_index(entries)

    raw = []
    writers: dict = {}   # data-file basename -> set of writer keys
    readers: dict = {}   # data-file basename -> set of reader keys

    for orig_key, entry in entries.items():
        key = orig_key.replace("\\", "/")
        text = _read_source(project_root, orig_key)
        if text:
            raw += _detect_subprocess(key, text, base_index, static)
            w, r = _scan_shared_file(key, text)
            for f in w:
                writers.setdefault(f, set()).add(key)
            for f in r:
                readers.setdefault(f, set()).add(key)
        raw += _detect_interface(key, entry, class_idx, static)

    # shared-file: pair each writer with each distinct reader of the same file
    for fname in set(writers) & set(readers):
        for src in writers[fname]:
            for tgt in readers[fname]:
                if src != tgt and tgt not in static.get(src, ()):
                    raw.append((src, tgt, "shared_file", f"writes/reads {fname}"))

    # dedupe by (source, target, signal); keep first evidence
    seen = set()
    cands = []
    for src, tgt, signal, evidence in raw:
        sig = (src, tgt, signal)
        if sig in seen:
            continue
        seen.add(sig)
        cands.append({
            "source": src,
            "target": tgt,
            "signal": signal,
            "evidence": evidence,
            "suggested_confidence": _CONFIDENCE[signal],
        })

    cands.sort(key=lambda c: (c["source"], c["target"], c["signal"]))
    return cands


def _cli():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    cands = find_candidates(root)
    truncated = len(cands) > _MAX_CANDIDATES
    if truncated:
        print(f"[edge_candidates] {len(cands)} candidates found; "
              f"emitting first {_MAX_CANDIDATES}.", file=sys.stderr)
        cands = cands[:_MAX_CANDIDATES]
    else:
        print(f"[edge_candidates] {len(cands)} candidate edge(s).", file=sys.stderr)
    print(json.dumps(cands, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _cli()
