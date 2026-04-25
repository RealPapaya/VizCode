#!/usr/bin/env python3
"""
parse_memo.py — VizCode per-file parser result cache

Stores scan_file() outputs keyed by (file sha256, parser sha256) so that
unchanged files can be skipped on subsequent builds.

Cache lives at: <project_root>/.local/scan_cache.json
Only the parser layer is cached; module/symbol/community assembly always
runs fresh so that downstream logic can evolve without schema migrations.
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

# Bump this when the stored payload schema changes incompatibly.
# Mismatched revisions cause a full cold-start rebuild.
MEMO_SCHEMA_REV = 1

_MEMO_FILENAME = "scan_cache.json"


# ─── Low-level helpers ────────────────────────────────────────────────────────

def digest_bytes(data: bytes) -> str:
    """SHA-256 hex digest of a byte string."""
    return hashlib.sha256(data).hexdigest()


def parser_fingerprint(fn) -> str:
    """Return SHA-256 of the source file that defines *fn*.

    Used so that editing a parser automatically invalidates all cached results
    for the file types that parser handles — no manual cache clearing needed.
    Returns '' if the source file cannot be located (e.g. built-in fallback).
    """
    if fn is None:
        return ""
    try:
        import inspect
        src_path = Path(inspect.getfile(fn))
        return digest_bytes(src_path.read_bytes())
    except Exception:
        return ""


# ─── Memo I/O ─────────────────────────────────────────────────────────────────

def _memo_path(project_root: Path) -> Path:
    return project_root / ".local" / _MEMO_FILENAME


def open_memo(project_root: Path) -> dict:
    """Load the on-disk cache.

    Returns the existing memo dict if the file is present and matches the
    current schema revision. Otherwise returns a fresh empty structure.
    """
    path = _memo_path(project_root)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(data, dict) and data.get("schema_rev") == MEMO_SCHEMA_REV:
                if isinstance(data.get("entries"), dict):
                    return data
        except Exception:
            pass
    return {"schema_rev": MEMO_SCHEMA_REV, "built_at": "", "entries": {}}


def flush_memo(memo: dict, project_root: Path) -> None:
    """Persist the in-memory memo dict to .local/scan_cache.json.

    Creates the .local directory if it does not exist (safe no-op if it does).
    """
    memo["built_at"] = datetime.now(timezone.utc).isoformat()
    path = _memo_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(memo, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8',
    )


# ─── Entry lookup / record ────────────────────────────────────────────────────

def lookup_entry(memo: dict, rel_path: str, file_sha: str, parser_sha: str):
    """Return the cached parse result (6-tuple) for *rel_path*, or None on miss.

    A cache entry is considered valid only when both the file content hash
    *and* the parser source hash match what was stored.  Either changing the
    file or editing the parser will cause a miss.
    """
    entry = memo["entries"].get(rel_path)
    if entry is None:
        return None
    if entry.get("file_sha") != file_sha or entry.get("parser_sha") != parser_sha:
        return None
    p = entry.get("payload")
    if not isinstance(p, dict):
        return None
    try:
        # 7-tuple with optional parse diagnostic (None when the parser parsed cleanly).
        return (
            p["imports"],
            p["funcdefs"],
            p["funccalls"],
            p["extras"],
            p["func_calls_by_func"],
            p["symdefs"],
            p.get("parse_diag"),
        )
    except (KeyError, TypeError):
        return None


def record_entry(
    memo: dict,
    rel_path: str,
    file_sha: str,
    parser_sha: str,
    result: tuple,
) -> None:
    """Store a 6- or 7-tuple parse result into the in-memory memo dict.

    Field naming deliberately uses VizCode's own vocabulary; see the Parser
    Interface Contract in CLAUDE.md for what each element represents.
    """
    n = len(result)
    if n == 6:
        incs, defs, calls, extra, fcbf, symdefs = result
        diag = None
    elif n == 7:
        incs, defs, calls, extra, fcbf, symdefs, diag = result
    else:
        # Defensive: coerce any other arity by padding/truncating.
        padded = list(result)[:7] + [None] * max(0, 7 - n)
        incs, defs, calls, extra, fcbf, symdefs, diag = padded
    memo["entries"][rel_path] = {
        "file_sha":   file_sha,
        "parser_sha": parser_sha,
        "payload": {
            "imports":            incs,
            "funcdefs":           defs,
            "funccalls":          calls,
            "extras":             extra,
            "func_calls_by_func": fcbf,
            "symdefs":            symdefs,
            "parse_diag":         diag,
        },
    }
