#!/usr/bin/env python3
"""
semantic_enricher.py — B1: optional AI-inferred semantic edges

Runs after analyze_viz.build_graph() has assembled the static graph. For each
source file in the project, collects (module-docstring, function signatures)
and asks an LLM to propose *semantic* edges between files that AST analysis
cannot see (e.g. "this orchestrator calls into that adapter by convention").

Design: zero-dependency (urllib.request only), fails silently, cached per file.
Only the Anthropic provider is wired — future providers branch inside _call_llm.
Edges are only merged into the graph when confidence >= threshold.
"""

import hashlib
import json
import os
import re
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SEM_SCHEMA_REV = 1
_SEM_FILENAME = "semantic_cache.json"
_BATCH_SIZE = 15
_MAX_SIGS_PER_FILE = 20
_DEFAULT_MODEL = "claude-sonnet-4-6"
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_MAX_TOKENS = 4096

_TEST_DIR_NAMES = {"tests", "test", "testproject", "__tests__", "spec", "specs"}
_TEST_FILE_PREFIX = ("test_", "spec_")
_TEST_FILE_SUFFIX = ("_test.py", "_spec.py", ".test.js", ".spec.js", ".test.ts", ".spec.ts")
_NON_CODE_EXTS = {".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff",
                  ".woff2", ".ttf", ".eot", ".pdf", ".zip", ".gz", ".tar"}


class SemanticEnrichError(Exception):
    pass


# ─── Role / skip heuristics ──────────────────────────────────────────────────

def _classify_role(rel_path: str) -> str:
    parts = rel_path.replace("\\", "/").split("/")
    last = parts[-1].lower()
    if any(p.lower() in _TEST_DIR_NAMES for p in parts[:-1]):
        return "test_fixture"
    if last.startswith(_TEST_FILE_PREFIX) or last.endswith(_TEST_FILE_SUFFIX):
        return "test_fixture"
    return "production"


def _is_non_code(rel_path: str) -> bool:
    return Path(rel_path).suffix.lower() in _NON_CODE_EXTS


# ─── Summary collection ──────────────────────────────────────────────────────

def _collect_file_summary(rel_path: str, funcs: list) -> dict:
    """Extract the minimum context an LLM needs to reason about a file."""
    module_doc = ""
    signatures = []
    for fn in funcs or []:
        label = fn.get("label") or fn.get("name") or ""
        doc = (fn.get("doc") or "").strip()
        if label == "__module__" and doc and not module_doc:
            module_doc = doc
            continue
        if not label or label.startswith("_"):
            continue
        sig = label
        if doc:
            first_line = doc.splitlines()[0].strip()
            if first_line:
                sig = f"{label} — {first_line[:120]}"
        signatures.append(sig)
        if len(signatures) >= _MAX_SIGS_PER_FILE:
            break
    return {
        "rel": rel_path,
        "doc": module_doc[:400],
        "signatures": signatures,
        "role": _classify_role(rel_path),
    }


def _summary_hash(summary: dict) -> str:
    blob = json.dumps(
        {"rel": summary["rel"], "doc": summary["doc"], "signatures": summary["signatures"]},
        sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


# ─── Cache I/O ───────────────────────────────────────────────────────────────

def _cache_path(project_root: Path) -> Path:
    return project_root / ".local" / _SEM_FILENAME


def _load_cache(project_root: Path) -> dict:
    path = _cache_path(project_root)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("schema_rev") == SEM_SCHEMA_REV:
                if isinstance(data.get("entries"), dict):
                    return data
        except Exception:
            pass
    return {"schema_rev": SEM_SCHEMA_REV, "built_at": "", "entries": {}}


def _flush_cache(cache: dict, project_root: Path) -> None:
    cache["built_at"] = datetime.now(timezone.utc).isoformat()
    path = _cache_path(project_root)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(cache, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    except Exception:
        pass


# ─── Prompt / LLM ────────────────────────────────────────────────────────────

_PROMPT_HEADER = """You are analysing a software project to surface SEMANTIC dependencies
that static AST analysis cannot see — "module A conceptually coordinates with module B"
rather than "module A imports module B".

For each file I give you its path, module docstring (if any), and top function signatures.
Propose inferred edges between these files. DO NOT propose edges that a static import
graph would obviously catch. Focus on design/role relationships: orchestrator → worker,
producer → consumer, gateway → backend, facade → implementation, etc.

Respond with STRICT JSON only, no prose, matching this schema:
{"edges":[{"source":"<rel_path>","target":"<rel_path>","confidence":0.0-1.0,"reason":"<=100 chars"}]}

Rules:
- source and target must both appear in the file list below.
- Omit any edge with confidence < 0.5.
- Return at most 3 outgoing edges per source file.
- Empty list is a valid response.
"""


def _build_prompt(batch: list) -> str:
    parts = [_PROMPT_HEADER, "\nFILES:\n"]
    for s in batch:
        parts.append(f"\n- path: {s['rel']}\n")
        if s["doc"]:
            parts.append(f"  doc: {s['doc']}\n")
        if s["signatures"]:
            parts.append("  signatures:\n")
            for sig in s["signatures"]:
                parts.append(f"    - {sig}\n")
    return "".join(parts)


def _call_anthropic(prompt: str, model: str, api_key: str) -> str:
    body = json.dumps({
        "model": model,
        "max_tokens": _MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(
        _ANTHROPIC_URL, data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    for block in payload.get("content", []):
        if block.get("type") == "text":
            return block.get("text", "")
    return ""


_JSON_RE = re.compile(r"\{[\s\S]*\}")


def _parse_response(text: str) -> list:
    """Extract the first JSON object from an LLM response, tolerant of wrappers."""
    if not text:
        return []
    m = _JSON_RE.search(text)
    if not m:
        return []
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return []
    edges = obj.get("edges") if isinstance(obj, dict) else None
    return edges if isinstance(edges, list) else []


# ─── Edge merging ────────────────────────────────────────────────────────────

def _merge_edges(data: dict, inferred: list, threshold: float,
                 rel_to_id: dict, rel_to_mod: dict, existing: set) -> tuple:
    """Return (kept, dropped). Mutates data['file_edges_by_module']."""
    file_edges_by_module = data.get("file_edges_by_module", {})
    kept = 0
    dropped = 0
    for e in inferred:
        try:
            src = e.get("source")
            tgt = e.get("target")
            conf = float(e.get("confidence", 0.0))
            reason = (e.get("reason") or "")[:160]
        except Exception:
            dropped += 1
            continue
        if src == tgt or src not in rel_to_id or tgt not in rel_to_id:
            dropped += 1
            continue
        if conf < threshold:
            dropped += 1
            continue
        sid, tid = rel_to_id[src], rel_to_id[tgt]
        sig = (sid, tid, "inferred")
        if sig in existing:
            continue
        existing.add(sig)
        src_mod = rel_to_mod.get(src, "_root")
        file_edges_by_module.setdefault(src_mod, []).append({
            "s": sid, "t": tid, "type": "inferred",
            "confidence": round(conf, 3), "reason": reason,
        })
        kept += 1
    return kept, dropped


# ─── Public entry ────────────────────────────────────────────────────────────

def enrich(data: dict, project_root: Path, opts: dict, progress_cb=None) -> dict:
    """Run AI enrichment. Returns a stats dict (always, even on failure)."""
    stats = {
        "static_edges": 0, "inferred_kept": 0, "inferred_dropped": 0,
        "llm_calls": 0, "cache_hits": 0, "files_considered": 0,
        "skipped": 0, "error": None,
    }

    threshold = float(opts.get("threshold", 0.7))
    model = opts.get("model") or _DEFAULT_MODEL
    include_tests = bool(opts.get("include_tests", False))

    # Count existing static file edges for the report
    file_edges_by_module = data.get("file_edges_by_module", {})
    existing_sigs = set()
    for mod_edges in file_edges_by_module.values():
        for e in mod_edges:
            existing_sigs.add((e["s"], e["t"], e.get("type", "import")))
    stats["static_edges"] = len(existing_sigs)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        stats["error"] = "ANTHROPIC_API_KEY not set — AI enrichment skipped"
        if progress_cb:
            progress_cb(99, stats["error"], stage="semantic")
        return stats

    # Build rel_to_id / rel_to_mod from files_by_module
    rel_to_id: dict = {}
    rel_to_mod: dict = {}
    for mod, files in data.get("files_by_module", {}).items():
        for f in files:
            rel_to_id[f["path"]] = f["id"]
            rel_to_mod[f["path"]] = mod

    # Collect summaries
    summaries = []
    for rel, funcs in data.get("funcs_by_file", {}).items():
        if rel not in rel_to_id:
            continue
        if _is_non_code(rel):
            stats["skipped"] += 1
            continue
        summary = _collect_file_summary(rel, funcs)
        if summary["role"] == "test_fixture" and not include_tests:
            stats["skipped"] += 1
            continue
        if not summary["doc"] and not summary["signatures"]:
            stats["skipped"] += 1
            continue
        summaries.append(summary)
    stats["files_considered"] = len(summaries)

    if not summaries:
        if progress_cb:
            progress_cb(99, "No files eligible for semantic enrichment", stage="semantic")
        return stats

    cache = _load_cache(project_root)
    entries = cache["entries"]

    # Batch and process
    batches = [summaries[i:i + _BATCH_SIZE] for i in range(0, len(summaries), _BATCH_SIZE)]
    total_batches = len(batches)

    for bi, batch in enumerate(batches):
        # Cache key: SHA-256 of all file hashes in this batch
        batch_hashes = [_summary_hash(s) for s in batch]
        batch_key = hashlib.sha256("|".join(sorted(batch_hashes)).encode()).hexdigest()

        if progress_cb:
            pct = 98 + int(2 * (bi / max(1, total_batches)))
            progress_cb(pct, f"AI enrichment batch {bi + 1}/{total_batches}", stage="semantic")

        cached = entries.get(batch_key)
        if cached and isinstance(cached.get("edges"), list):
            inferred = cached["edges"]
            stats["cache_hits"] += len(batch)
        else:
            prompt = _build_prompt(batch)
            try:
                raw = _call_anthropic(prompt, model, api_key)
                inferred = _parse_response(raw)
                entries[batch_key] = {
                    "edges": inferred,
                    "cached_at": datetime.now(timezone.utc).isoformat(),
                    "file_count": len(batch),
                }
                stats["llm_calls"] += 1
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                stats["error"] = f"LLM call failed: {exc}"
                continue
            except Exception as exc:
                stats["error"] = f"LLM call error: {exc}"
                continue

        kept, dropped = _merge_edges(data, inferred, threshold,
                                     rel_to_id, rel_to_mod, existing_sigs)
        stats["inferred_kept"] += kept
        stats["inferred_dropped"] += dropped

    _flush_cache(cache, project_root)
    return stats
