"""
qa_cache.py — AI Q&A 快取，存放於 .vizcode/ai_qa_cache.json

公開 API:
  lookup(question, project_root, scan_cache, depth) -> dict | None
  save(question, answer, tool_calls, project_root, scan_cache, depth, provider) -> None
  record_hit(project_root, entry_id) -> None
"""

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_QA_FILENAME = "ai_qa_cache.json"
_SCHEMA_REV  = 1
_MAX_ENTRIES = 200


# ─── 快取路徑 ────────────────────────────────────────────────────────────────

def _cache_path(project_root: Path) -> Path:
    return project_root / ".vizcode" / _QA_FILENAME


def _load(project_root: Path) -> dict:
    path = _cache_path(project_root)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("schema_rev") == _SCHEMA_REV:
                return data
        except Exception:
            pass
    return {"schema_rev": _SCHEMA_REV, "built_at": "", "entries": []}


def _flush(data: dict, project_root: Path) -> None:
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


# ─── 問題標準化 & hash ────────────────────────────────────────────────────────

def _normalize(q: str) -> str:
    q = q.lower()
    q = re.sub(r"[^\w\s]", " ", q)
    return re.sub(r"\s+", " ", q).strip()


def _question_hash(q: str) -> str:
    return hashlib.sha256(_normalize(q).encode("utf-8")).hexdigest()[:16]


# ─── 相關檔案提取 ─────────────────────────────────────────────────────────────

def _extract_related_files(text: str, scan_keys: list) -> list:
    """從文字中找出 scan_keys 裡出現的檔案名稱（stem 或 basename 匹配）。"""
    t_lower = text.lower()
    related = []
    for key in scan_keys:
        p = Path(key)
        stem = p.stem.lower()
        name = p.name.lower()
        if (stem and len(stem) > 2 and stem in t_lower) or (name in t_lower):
            related.append(key)
    return list(dict.fromkeys(related))


# ─── 快取驗證 ─────────────────────────────────────────────────────────────────

def _get_file_sha(file_key: str, scan_cache: dict) -> str:
    entry = scan_cache.get("entries", {}).get(file_key, {})
    return entry.get("file_sha", "")


def _is_entry_valid(entry: dict, scan_cache: dict) -> bool:
    """若 related_files 的所有 SHA 仍與 scan_cache 相符，回傳 True。"""
    file_hashes = entry.get("file_hashes", {})
    if not file_hashes:
        return False
    for file_key, cached_sha in file_hashes.items():
        if _get_file_sha(file_key, scan_cache) != cached_sha:
            return False
    return True


# ─── 公開 API ─────────────────────────────────────────────────────────────────

def lookup(
    question: str,
    project_root,
    scan_cache: dict,
    depth: str = "general",
    output: str = "",
    context_hash: str = "",
) -> Optional[dict]:
    """若找到有效的快取命中，回傳 entry dict，否則回傳 None。"""
    project_root = Path(project_root)
    entries = _load(project_root).get("entries", [])
    if not entries:
        return None

    q_hash = _question_hash(question)
    for entry in entries:
        if entry.get("question_hash") != q_hash:
            continue
        if entry.get("depth", "general") != depth:
            continue
        if entry.get("output", "") != (output or ""):
            continue
        if entry.get("context_hash", "") != (context_hash or ""):
            continue
        if not _is_entry_valid(entry, scan_cache):
            continue
        return entry
    return None


def save(
    question: str,
    answer: str,
    tool_calls: list,
    project_root,
    scan_cache: dict,
    depth: str = "general",
    provider: str = "",
    output: str = "",
    context_hash: str = "",
) -> None:
    """將一輪 Q&A 寫入快取。"""
    if not question.strip() or not answer.strip():
        return

    project_root = Path(project_root)
    scan_keys = list(scan_cache.get("entries", {}).keys())

    # 從問題文字提取相關檔案
    related_files = _extract_related_files(question, scan_keys)

    # 從工具呼叫的 input 值也補充相關檔案
    for tc in tool_calls:
        for v in (tc.get("input") or {}).values():
            if isinstance(v, str):
                related_files.extend(_extract_related_files(v, scan_keys))

    related_files = list(dict.fromkeys(related_files))

    # 記錄各相關檔案的當前 SHA
    file_hashes = {f: _get_file_sha(f, scan_cache) for f in related_files
                   if _get_file_sha(f, scan_cache)}

    # 工具呼叫的 input 字串值作為 related_modules 提示
    related_modules = []
    for tc in tool_calls:
        for v in (tc.get("input") or {}).values():
            if isinstance(v, str) and v:
                related_modules.append(v)
    related_modules = list(dict.fromkeys(related_modules))

    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "id":              uuid.uuid4().hex[:8],
        "question":        question,
        "question_hash":   _question_hash(question),
        "related_files":   related_files,
        "related_modules": related_modules,
        "file_hashes":     file_hashes,
        "answer":          answer,
        "tool_calls":      tool_calls,
        "depth":           depth,
        "output":          output or "",
        "context_hash":    context_hash or "",
        "provider":        provider,
        "created_at":      now,
        "hits":            0,
        "last_hit_at":     None,
    }

    data = _load(project_root)
    q_hash = _question_hash(question)
    # 取代同一問題的舊快取
    entries = [e for e in data.get("entries", [])
               if not (
                   e.get("question_hash") == q_hash
                   and e.get("depth", "general") == depth
                   and e.get("output", "") == (output or "")
                   and e.get("context_hash", "") == (context_hash or "")
               )]
    entries.insert(0, entry)
    data["entries"] = entries[:_MAX_ENTRIES]
    _flush(data, project_root)


def record_hit(project_root, entry_id: str) -> None:
    """更新命中次數與 last_hit_at。"""
    project_root = Path(project_root)
    data = _load(project_root)
    for entry in data.get("entries", []):
        if entry.get("id") == entry_id:
            entry["hits"] = entry.get("hits", 0) + 1
            entry["last_hit_at"] = datetime.now(timezone.utc).isoformat()
            break
    _flush(data, project_root)
