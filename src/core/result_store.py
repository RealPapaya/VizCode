#!/usr/bin/env python3
"""
result_store.py — persist & restore a full build_graph() result.

Unlike scan_cache.json (parser-output layer only), this stores the *assembled*
graph data dict that build_html() consumes, so a previous scan can be reopened
with full functionality (AI, source panel, …) after a server restart without
re-analyzing.

Artifacts live under <root>/.vizcode/:
  - result.json       the full graph `data` dict (sets are flattened to lists)
  - result_meta.json  tiny header for cheap listing on the homepage

Schema note: result.json mirrors whatever build_graph() returns. Bump
RESULT_SCHEMA_REV whenever that shape changes incompatibly so stale snapshots
are ignored (forcing a fresh rescan) instead of being fed to a newer build_html.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

# Bump when the build_graph() data shape changes incompatibly.
RESULT_SCHEMA_REV = 1

_RESULT_FILE   = "result.json"
_META_FILE     = "result_meta.json"


def _vizcode_dir(root) -> Path:
    return Path(root) / ".vizcode"


def _json_default(o):
    """Flatten sets (mirrors html_builder so the round-trip matches the browser)."""
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    raise TypeError(f"Not serialisable: {type(o)}")


def _summary(data: dict) -> dict:
    """Pull scalar counts for the homepage listing, tolerant of missing keys."""
    s = data.get("stats", {}) if isinstance(data, dict) else {}
    def _int(v):
        return v if isinstance(v, int) else (len(v) if isinstance(v, (list, set)) else 0)
    return {
        "files":     _int(s.get("total_all_files", s.get("files", 0))),
        "functions": _int(s.get("functions", 0)),
        "modules":   _int(s.get("modules", 0)),
    }


# ─── Save ─────────────────────────────────────────────────────────────────────

def save_result(root, data: dict):
    """Persist the full graph data + meta so the scan can be reopened later.

    Returns the result.json Path on success, None on any failure (non-fatal).
    """
    try:
        from .local_dir import ensure_local_dir
        d = ensure_local_dir(root)
        now = datetime.now(timezone.utc)
        meta = {
            "schema_rev":     RESULT_SCHEMA_REV,
            "built_at":       now.isoformat(),
            "built_at_epoch": now.timestamp(),
            "root":           str(Path(root).resolve()),
            "name":           Path(root).resolve().name or "VIZCODE",
            "summary":        _summary(data),
        }
        (d / _RESULT_FILE).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":"),
                       default=_json_default),
            encoding="utf-8",
        )
        (d / _META_FILE).write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8",
        )
        return d / _RESULT_FILE
    except Exception:
        return None


# ─── Load ─────────────────────────────────────────────────────────────────────

def load_meta(root):
    """Return the meta header dict for a persisted result, or None if absent/stale."""
    path = _vizcode_dir(root) / _META_FILE
    if not path.is_file():
        return None
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(meta, dict) or meta.get("schema_rev") != RESULT_SCHEMA_REV:
        return None
    return meta


def load_result(root):
    """Return the persisted graph `data` dict, or None if absent/stale.

    The meta header is validated first so a schema bump silently invalidates
    older snapshots without raising.
    """
    if load_meta(root) is None:
        return None
    path = _vizcode_dir(root) / _RESULT_FILE
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def has_result(root) -> bool:
    """Cheap check (meta only) for whether a reopenable scan exists for *root*."""
    return load_meta(root) is not None
