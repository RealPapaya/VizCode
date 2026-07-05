#!/usr/bin/env python3
"""
semantic_enricher.py — semantic cache I/O module

Provides read/write access to .vizcode/semantic_cache.json.
API call logic has been removed; the cache is now populated by the
Claude Code skill (B2) which writes inferred edges via write_cache().

Kept interface:
  write_cache(project_root, inferred_edges, scan_cache=None) -> None
  read_cache(project_root)                                   -> list[dict]
  is_cache_valid(project_root, scan_cache)                   -> bool

CLI usage (called by SKILL.md):
  python semantic_enricher.py write <project_root> < edges.json
  python semantic_enricher.py check <project_root> < scan_cache.json
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

SEM_SCHEMA_REV = 1
_SEM_FILENAME = "semantic_cache.json"


# ─── Cache path ──────────────────────────────────────────────────────────────

def _cache_path(project_root: Path) -> Path:
    return project_root / ".vizcode" / _SEM_FILENAME


# ─── Internal load/flush ─────────────────────────────────────────────────────

def _load_raw(project_root: Path) -> dict:
    path = _cache_path(project_root)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("schema_rev") == SEM_SCHEMA_REV:
                return data
        except Exception:
            pass
    return {"schema_rev": SEM_SCHEMA_REV, "built_at": "", "module_hashes": {}, "edges": []}


def _flush_raw(data: dict, project_root: Path) -> None:
    data["built_at"] = datetime.now(timezone.utc).isoformat()
    path = _cache_path(project_root)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    except Exception:
        pass


# ─── Public API ──────────────────────────────────────────────────────────────

def write_cache(project_root, inferred_edges: list, scan_cache: dict = None) -> None:
    """
    Write inferred edges to .vizcode/semantic_cache.json.

    inferred_edges format:
    [
      {
        "source": "analyze_viz.py",
        "target": "python_parser.py",
        "confidence": 0.88,
        "reason": "analyze_viz calls python_parser for AST extraction",
        "origin": "derived"   # optional: "derived" (local candidate, confirmed)
                              #           or "inferred" (LLM-discovered, default)
      },
      ...
    ]

    `origin` records provenance so downstream consumers can split the broad
    "inferred" bucket into DERIVED (locally grounded + model-confirmed) vs
    INFERRED (pure model). Optional and additive: a missing/blank value, or
    anything other than "derived", is treated as "inferred" — old caches stay
    valid with no schema bump.

    If scan_cache is provided, stores its SHA-256 hash so is_cache_valid()
    can detect when the underlying scan results have changed.
    """
    project_root = Path(project_root)
    data = _load_raw(project_root)
    data["edges"] = [
        {
            "source":     str(e.get("source", "")),
            "target":     str(e.get("target", "")),
            "confidence": round(float(e.get("confidence", 0.0)), 3),
            "reason":     str(e.get("reason", ""))[:160],
            "origin":     "derived" if str(e.get("origin", "")).lower() == "derived"
                          else "inferred",
        }
        for e in inferred_edges
        if e.get("source") and e.get("target")
    ]
    if scan_cache is not None:
        data["scan_hash"] = hashlib.sha256(
            json.dumps(scan_cache, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()
    _flush_raw(data, project_root)


def read_cache(project_root) -> list:
    """Return the list of inferred edges from .vizcode/semantic_cache.json."""
    project_root = Path(project_root)
    data = _load_raw(project_root)
    edges = data.get("edges", [])
    return edges if isinstance(edges, list) else []


def is_cache_valid(project_root, scan_cache: dict) -> bool:
    """
    Return True if the semantic cache is still valid for the given scan_cache.

    Validity check: the semantic cache records a SHA-256 hash of the
    scan_cache content at the time it was written. If the scan_cache has
    changed since then, the semantic cache is stale.
    """
    project_root = Path(project_root)
    sem = _load_raw(project_root)
    if not sem.get("edges"):
        return False
    stored_hash = sem.get("scan_hash", "")
    if not stored_hash:
        return False
    current_hash = hashlib.sha256(
        json.dumps(scan_cache, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return stored_hash == current_hash


# ─── CLI entry point (used by SKILL.md) ──────────────────────────────────────

def _cli():
    """
    Commands:
      write <project_root>  — read JSON edges from stdin, write semantic_cache.json
      check <project_root>  — read scan_cache JSON from stdin, print valid/stale
    """
    import sys
    args = sys.argv[1:]
    if len(args) < 2:
        print("Usage: semantic_enricher.py <write|check> <project_root>", file=sys.stderr)
        sys.exit(1)

    cmd, root = args[0], args[1]
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as e:
        print(f"Error reading stdin JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if cmd == "write":
        if not isinstance(payload, list):
            print("Error: stdin must be a JSON array of edge objects", file=sys.stderr)
            sys.exit(1)
        write_cache(root, payload)
        print(f"Written {len(payload)} inferred edge(s) to {Path(root) / '.vizcode' / _SEM_FILENAME}")

    elif cmd == "check":
        if not isinstance(payload, dict):
            print("Error: stdin must be a JSON object (scan_cache)", file=sys.stderr)
            sys.exit(1)
        valid = is_cache_valid(root, payload)
        print("valid" if valid else "stale")

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    _cli()
