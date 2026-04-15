#!/usr/bin/env python3
"""
semantic_enricher.py — semantic cache I/O module

Provides read/write access to .local/semantic_cache.json.
API call logic has been removed; the cache is now populated by the
Claude Code skill (B2) which writes inferred edges via write_cache().

Kept interface:
  write_cache(project_root, inferred_edges) -> None
  read_cache(project_root)                  -> list[dict]
  is_cache_valid(project_root, scan_cache)  -> bool
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

SEM_SCHEMA_REV = 1
_SEM_FILENAME = "semantic_cache.json"


# ─── Cache path ──────────────────────────────────────────────────────────────

def _cache_path(project_root: Path) -> Path:
    return project_root / ".local" / _SEM_FILENAME


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

def write_cache(project_root, inferred_edges: list) -> None:
    """
    Write inferred edges to .local/semantic_cache.json.

    inferred_edges format:
    [
      {
        "source": "analyze_viz.py",
        "target": "python_parser.py",
        "confidence": 0.88,
        "reason": "analyze_viz calls python_parser for AST extraction"
      },
      ...
    ]
    """
    project_root = Path(project_root)
    data = _load_raw(project_root)
    data["edges"] = [
        {
            "source":     str(e.get("source", "")),
            "target":     str(e.get("target", "")),
            "confidence": round(float(e.get("confidence", 0.0)), 3),
            "reason":     str(e.get("reason", ""))[:160],
        }
        for e in inferred_edges
        if e.get("source") and e.get("target")
    ]
    _flush_raw(data, project_root)


def read_cache(project_root) -> list:
    """Return the list of inferred edges from .local/semantic_cache.json."""
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
