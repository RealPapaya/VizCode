"""
ai/vizbridge.py — VizBridge core engine.

Orchestrates AI chat over the VizCode codebase:
  - ToolRegistry   : wraps the 8 vizcode_* tools (reads .vizcode/ cache directly)
  - ContextInjector: builds a system prompt from scan_cache stats
  - ProviderRouter : selects the AI provider from config / env vars
  - VizBridge      : main entry — stream_response() drives the tool-use loop

Config precedence (highest first):
  1. Environment variable   ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
  2. ai/config.json         (gitignored)

Usage (from server.py):
    from ai.vizbridge import VizBridge
    vb = VizBridge(project_root)
    for event in vb.stream_response(messages):
        send_sse(event)
"""

from __future__ import annotations

import json
import os
import hashlib
import re
import sys
import time
from collections import deque
from pathlib import Path
from typing import Iterator

# ─── path bootstrap (allow running from project root) ────────────────────────
_HERE = Path(__file__).parent
_ROOT = _HERE.parent
_IMPORT_DIRS = (
    _ROOT,
    _ROOT / "src" / "core",
    _ROOT / "src",
)
for _import_dir in _IMPORT_DIRS:
    _import_dir_str = str(_import_dir)
    if _import_dir_str not in sys.path:
        sys.path.insert(0, _import_dir_str)
_SERVER_IMPORT_DIR = str(_ROOT / "src" / "server")
if _SERVER_IMPORT_DIR not in sys.path:
    sys.path.append(_SERVER_IMPORT_DIR)

# Import tool implementations from mcp_server (no MCP protocol needed)
from mcp_server import (
    _load_json,
    _build_index,
    _build_stem_index,
    _build_symbol_index,
    _budget_for_filecount,
    _DEFAULT_TOOL_BUDGET,
    _tool_l0,
    _tool_l1,
    _tool_l2,
    _tool_l3,
    _tool_health,
    _tool_query,
    _tool_path,
    _tool_context,
    _tool_trace,
    _tool_affected,
    _tool_explain,
    _tool_report,
    TOOLS as MCP_TOOL_SCHEMAS,
)

# Canvas-driving tools (web UI only — emit ui_action SSE events)
from ai.ui_tools import (
    UI_TOOL_SCHEMAS,
    UI_TOOL_NAMES,
    dispatch as ui_dispatch,
)

# Conversation mode registry
from ai.chat_modes import resolve_spec as _resolve_mode_spec

# ─── Config ───────────────────────────────────────────────────────────────────

_CONFIG_PATH = _HERE / "config.json"
_KEYS_PATH = _ROOT / ".vizcode" / "key" / "ai_keys.json"
_LEGACY_KEYS_PATH = _ROOT / ".vizcode" / "ai_keys.json"   # pre-folder migration
_SECRET_FIELDS = (
    "anthropic_api_key",
    "openai_api_key",
    "grok_api_key",
    "gemini_api_key",
    "custom_api_key",
)

_DEFAULTS: dict = {
    "ai_mode":             "api",
    "provider":            "anthropic",
    "anthropic_api_key":   "",
    "anthropic_model":     "claude-sonnet-4-6",
    "openai_api_key":      "",
    "openai_model":        "gpt-4o",
    "openai_base_url":     "",
    "openai_api_version":  "",
    "grok_api_key":        "",
    "grok_model":          "grok-4.20",
    "gemini_api_key":      "",
    "gemini_model":        "gemini-2.0-flash",
    "ollama_url":          "",
    "ollama_model":        "llama3.1",
    "custom_api_key":      "",
    "custom_base_url":     "",
    "custom_model":        "",
    "cli_agent":           "claude",
    "cli_model":           "",
    "claude_cli_path":     "",
    "codex_cli_path":      "",
    "gemini_cli_path":     "",
}

_MAX_HISTORY_MESSAGES = 8
_MAX_HISTORY_CHARS = 12_000
_MAX_LATEST_MESSAGE_CHARS = 8_000
_QUERY_LOG_FILENAME = "ai_query_log.jsonl"
# Per-tool result char budgets come from mcp_server._budget_for_filecount (scaled to
# repo size). ~3 chars/token is the clamp ratio used to keep a tool result under the
# active provider token ceiling.
_CHARS_PER_TOKEN = 3

# Appended to the system prompt when a CLI agent has no tools left for the turn,
# forcing it to answer in prose instead of emitting another protocol line.
_CLI_FINAL_TURN_HINT = (
    "\n\nFINAL TURN: You have no more tools available. Using ONLY the tool results "
    "already shown in this conversation, answer the user's question directly in prose. "
    "Do NOT output any VIZCODE_TOOL or VIZCODE_UI line."
)


def _clip_text(text: str, limit: int, label: str = "content") -> str:
    if limit <= 0 or len(text) <= limit:
        return text
    omitted = len(text) - limit
    return (
        text[:limit].rstrip()
        + f"\n\n[truncated {label}: omitted {omitted} chars; narrow the question, "
          "reduce node_cap, add relation_filter, or ask for one file/symbol for full detail]"
    )


def _message_text_for_budget(msg: dict) -> str:
    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(str(item.get("text", "")))
                elif item.get("type") == "tool_use":
                    parts.append(json.dumps(item, ensure_ascii=False))
        return "\n".join(parts)
    return str(content)


def _truncate_message_for_budget(msg: dict, limit: int) -> dict:
    if limit <= 0:
        return msg
    content = msg.get("content", "")
    if not isinstance(content, str) or len(content) <= limit:
        return msg
    suffix = (
        "\n\n[message truncated before sending; ask with a narrower scope or "
        "split the request for full detail]"
    )
    keep = max(0, limit - len(suffix))
    out = dict(msg)
    out["content"] = content[:keep].rstrip() + suffix
    return out


def trim_history(
    messages: list[dict],
    *,
    max_messages: int = _MAX_HISTORY_MESSAGES,
    max_chars: int = _MAX_HISTORY_CHARS,
) -> list[dict]:
    """Return a compact suffix of the conversation while always keeping the latest turn."""
    if not messages:
        return []

    latest = _truncate_message_for_budget(
        messages[-1],
        min(max_chars, _MAX_LATEST_MESSAGE_CHARS),
    )
    kept_rev = [latest]
    char_budget = len(_message_text_for_budget(latest))

    for msg in reversed(messages[:-1]):
        if len(kept_rev) >= max_messages:
            break
        msg_chars = len(_message_text_for_budget(msg))
        if char_budget + msg_chars > max_chars:
            break
        kept_rev.append(msg)
        char_budget += msg_chars

    return list(reversed(kept_rev))


def _tool_result_ids(messages: list[dict]) -> set[str]:
    return {
        str(m.get("tool_use_id", ""))
        for m in messages
        if isinstance(m, dict) and m.get("role") == "tool" and m.get("tool_use_id")
    }


def _assistant_tool_use_ids(msg: dict) -> set[str]:
    ids: set[str] = set()
    content = msg.get("content", [])
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "tool_use" and item.get("id"):
                ids.add(str(item["id"]))
    return ids


def _trim_working_history(messages: list[dict]) -> list[dict]:
    trimmed = trim_history(messages)
    needed = _tool_result_ids(trimmed)
    if not needed:
        return trimmed
    present = set()
    for msg in trimmed:
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            present.update(_assistant_tool_use_ids(msg))
    missing = needed - present
    if not missing:
        return trimmed
    inserts: list[dict] = []
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "assistant":
            continue
        ids = _assistant_tool_use_ids(msg)
        if ids & missing and msg not in trimmed:
            inserts.append(msg)
            missing -= ids
        if not missing:
            break
    return inserts + trimmed


def _read_json_file(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _mask_secret(val: str) -> str:
    if not val:
        return ""
    if len(val) > 8:
        return val[:4] + "****" + val[-4:]
    return "****"


def load_config() -> dict:
    """Merge defaults, ai/config.json, and persisted keys. Returns a copy."""
    cfg = dict(_DEFAULTS)
    cfg.update(_read_json_file(_CONFIG_PATH))
    key_cfg = _read_json_file(_KEYS_PATH)
    if not any(key_cfg.values()) and _LEGACY_KEYS_PATH.is_file():
        key_cfg = _read_json_file(_LEGACY_KEYS_PATH)
        if any(key_cfg.values()):
            _write_json_file(_KEYS_PATH, key_cfg)
            try: _LEGACY_KEYS_PATH.unlink()
            except Exception: pass
    cfg.update(key_cfg)
    # Environment variable overrides
    if os.environ.get("ANTHROPIC_API_KEY"):
        cfg["anthropic_api_key"] = os.environ["ANTHROPIC_API_KEY"]
        cfg.setdefault("provider", "anthropic")
    if os.environ.get("OPENAI_API_KEY"):
        cfg["openai_api_key"] = os.environ["OPENAI_API_KEY"]
    if os.environ.get("XAI_API_KEY"):
        cfg["grok_api_key"] = os.environ["XAI_API_KEY"]
    if os.environ.get("GEMINI_API_KEY"):
        cfg["gemini_api_key"] = os.environ["GEMINI_API_KEY"]
    return cfg


def save_config(updates: dict) -> None:
    """Persist non-secret config to ai/config.json and secrets to .local."""
    disk_cfg = _read_json_file(_CONFIG_PATH)
    key_cfg = _read_json_file(_KEYS_PATH)

    # Migrate any legacy key fields still stored in ai/config.json.
    for key in _SECRET_FIELDS:
        legacy = disk_cfg.pop(key, "")
        if legacy and not key_cfg.get(key):
            key_cfg[key] = legacy

    for key, val in updates.items():
        if key in _SECRET_FIELDS:
            raw = str(val or "").strip()
            if not raw or "****" in raw or all(c == "*" for c in raw):
                continue
            key_cfg[key] = raw
            continue
        disk_cfg[key] = val

    cfg_to_write = {
        k: v for k, v in disk_cfg.items()
        if k not in _SECRET_FIELDS and v != _DEFAULTS.get(k, "")
    }
    keys_to_write = {k: v for k, v in key_cfg.items() if v}

    _write_json_file(_CONFIG_PATH, cfg_to_write)
    _write_json_file(_KEYS_PATH, keys_to_write)


def masked_config() -> dict:
    """Return config safe to expose to the browser (mask API keys)."""
    cfg = load_config()
    out = dict(cfg)
    for key in _SECRET_FIELDS:
        val = cfg.get(key, "")
        out[key] = _mask_secret(val)
        out[f"{key}_present"] = bool(val)
    out["key_store_dir"] = str(_KEYS_PATH.parent)
    out["key_store_file"] = str(_KEYS_PATH)
    out["ollama_url_present"] = bool(cfg.get("ollama_url"))
    return out


def cli_agents_config() -> dict:
    """Return detected local CLI agents and current CLI selection."""
    from ai.cli_runtime import availability_report
    return availability_report(load_config())


# ─── ProviderRouter ───────────────────────────────────────────────────────────

class ProviderRouter:
    """Return the appropriate provider instance based on config."""

    def __init__(self, cfg: dict):
        self._cfg = cfg

    def get_provider(self):
        """Return a BaseProvider instance or raise ValueError."""
        provider = self._cfg.get("provider", "anthropic").lower()

        if provider == "anthropic":
            from ai.providers.anthropic_provider import AnthropicProvider
            key = self._cfg.get("anthropic_api_key", "")
            if not key:
                raise ValueError(
                    "Anthropic API key not configured. "
                    "Set ANTHROPIC_API_KEY or save via POST /chat-config."
                )
            return AnthropicProvider(
                api_key=key,
                model=self._cfg.get("anthropic_model", "claude-sonnet-4-6"),
            )

        if provider == "openai":
            from ai.providers.openai_provider import OpenAIProvider
            key = self._cfg.get("openai_api_key", "")
            if not key:
                raise ValueError(
                    "OpenAI API key not configured. "
                    "Set OPENAI_API_KEY or save via the chat settings panel."
                )
            return OpenAIProvider(
                api_key=key,
                model=self._cfg.get("openai_model", "gpt-4o"),
                base_url=self._cfg.get("openai_base_url", ""),
                api_version=self._cfg.get("openai_api_version", ""),
            )

        if provider == "gemini":
            from ai.providers.gemini_provider import GeminiProvider
            key = self._cfg.get("gemini_api_key", "")
            if not key:
                raise ValueError(
                    "Gemini API key not configured. "
                    "Set GEMINI_API_KEY or save via the chat settings panel."
                )
            return GeminiProvider(
                api_key=key,
                model=self._cfg.get("gemini_model", "gemini-2.0-flash"),
            )

        if provider == "grok":
            from ai.providers.grok_provider import GrokProvider
            key = self._cfg.get("grok_api_key", "")
            if not key:
                raise ValueError(
                    "Grok API key not configured. "
                    "Set XAI_API_KEY or save via the chat settings panel."
                )
            return GrokProvider(
                api_key=key,
                model=self._cfg.get("grok_model", "grok-4.20"),
            )

        if provider == "ollama":
            from ai.providers.ollama_provider import OllamaProvider
            return OllamaProvider(
                url=self._cfg.get("ollama_url", "http://localhost:11434"),
                model=self._cfg.get("ollama_model", "llama3.1"),
            )

        if provider == "custom":
            from ai.providers.custom_provider import CustomProvider
            key = self._cfg.get("custom_api_key", "")
            base_url = self._cfg.get("custom_base_url", "")
            if not base_url:
                raise ValueError(
                    "Custom provider requires a Base URL. "
                    "Set custom_base_url via the chat settings panel."
                )
            if not key:
                raise ValueError(
                    "Custom provider requires an API key. "
                    "Set custom_api_key via the chat settings panel."
                )
            return CustomProvider(
                api_key=key,
                base_url=base_url,
                model=self._cfg.get("custom_model", ""),
            )

        raise ValueError(f"Unknown provider: {provider!r}")


_TOOL_INDEX_CACHE: dict[tuple, dict] = {}
_NODES_RE = re.compile(r"\b(?:up to\s+)?(\d+)\s+nodes?\b", re.I)


def _file_signature(path: Path) -> tuple[str, int, int]:
    try:
        st = path.stat()
        return (str(path.resolve()), st.st_size, st.st_mtime_ns)
    except OSError:
        return (str(path.resolve()), -1, -1)


def _hash_payload(payload) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _nodes_from_text(text: str) -> int | None:
    m = _NODES_RE.search(text or "")
    return int(m.group(1)) if m else None


def _query_log_disabled() -> bool:
    return os.environ.get("VIZCODE_QUERY_LOG_DISABLE", "").lower() in ("1", "true", "yes")


def _append_query_log(project_root: Path, record: dict) -> None:
    if _query_log_disabled():
        return
    try:
        log_path = project_root / ".vizcode" / _QUERY_LOG_FILENAME
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        pass


# ─── ToolRegistry ─────────────────────────────────────────────────────────────

class ToolRegistry:
    """
    Wraps the 8 vizcode_* tool implementations from mcp_server.py.
    Loads .vizcode/scan_cache.json lazily on first call.
    """

    def __init__(self, project_root: str):
        self._root = Path(project_root)
        self._scan_path = self._root / ".vizcode" / "scan_cache.json"
        self._sem_path  = self._root / ".vizcode" / "semantic_cache.json"
        self._report_path = self._root / ".vizcode" / "vizcode_report.md"
        self._modules: dict | None = None
        self._edges:   list | None = None
        self._adj:     dict | None = None
        self._mod_to_files:  dict | None = None
        self._stem_to_key:   dict | None = None
        self._symidx:        dict | None = None
        self._budgets:       dict | None = None
        self._token_ceiling: int | None = None

    def _ensure_loaded(self) -> None:
        if self._modules is not None:
            return
        cache_key = (_file_signature(self._scan_path), _file_signature(self._sem_path))
        cached = _TOOL_INDEX_CACHE.get(cache_key)
        if cached:
            self._modules = cached["modules"]
            self._edges = cached["edges"]
            self._adj = cached["adj"]
            self._mod_to_files = cached["mod_to_files"]
            self._stem_to_key = cached["stem_to_key"]
            self._symidx = cached["symidx"]
            self._budgets = cached["budgets"]
            return

        scan = _load_json(str(self._scan_path))
        sem  = _load_json(str(self._sem_path))
        self._modules, self._edges, self._adj = _build_index(scan, sem)
        self._mod_to_files, self._stem_to_key = _build_stem_index(self._modules)
        self._symidx = _build_symbol_index(self._modules, self._stem_to_key)
        self._budgets = _budget_for_filecount(len(self._modules))
        _TOOL_INDEX_CACHE[cache_key] = {
            "modules": self._modules,
            "edges": self._edges,
            "adj": self._adj,
            "mod_to_files": self._mod_to_files,
            "stem_to_key": self._stem_to_key,
            "symidx": self._symidx,
            "budgets": self._budgets,
        }
        while len(_TOOL_INDEX_CACHE) > 4:
            _TOOL_INDEX_CACHE.pop(next(iter(_TOOL_INDEX_CACHE)))

    def set_token_ceiling(self, max_tokens: int | None) -> None:
        """Cap tool-result size to the active provider token budget (see _CHARS_PER_TOKEN)."""
        self._token_ceiling = int(max_tokens) if max_tokens else None

    def _budget_for(self, name: str) -> int:
        limit = (self._budgets or {}).get(name, _DEFAULT_TOOL_BUDGET)
        if self._token_ceiling:
            limit = min(limit, self._token_ceiling * _CHARS_PER_TOKEN)
        return limit

    def call(self, name: str, args: dict) -> str:
        """Call a tool by name and return its Markdown result string."""
        started = time.perf_counter()
        self._ensure_loaded()
        m  = self._modules
        e  = self._edges
        a  = self._adj
        mf = self._mod_to_files
        sk = self._stem_to_key
        sx = self._symidx
        budget = self._budget_for(name)

        if name == "vizcode_l0":
            result = _tool_l0(m, mf, sk)
        elif name == "vizcode_l1":
            result = _tool_l1(args.get("module", "."), m, mf, sk)
        elif name == "vizcode_l2":
            result = _tool_l2(args.get("file", ""), m)
        elif name == "vizcode_l3":
            result = _tool_l3(args.get("file", ""), m)
        elif name == "vizcode_query":
            result = _tool_query(args.get("question", ""), m, e, sx)
        elif name == "vizcode_path":
            result = _tool_path(args.get("source", ""), args.get("target", ""), m, a)
        elif name == "vizcode_context":
            result = _tool_context(args.get("question", ""), m, mf, sk, sx, e, a,
                                   char_budget=budget,
                                   relation_filter=args.get("relation_filter"),
                                   mode=args.get("mode", "broad"),
                                   node_cap=args.get("node_cap", 12))
        elif name == "vizcode_trace":
            result = _tool_trace(args.get("source", ""), args.get("target", ""), m, a, sk, sx,
                                 char_budget=budget)
        elif name == "vizcode_affected":
            result = _tool_affected(
                args.get("target", ""), m, sk, sx,
                depth=args.get("depth", 2),
                relation_filter=args.get("relation_filter"),
                char_budget=budget,
            )
        elif name == "vizcode_explain":
            result = _tool_explain(args.get("symbol", ""), m, e)
        elif name == "vizcode_health":
            result = _tool_health(m, sk)
        elif name == "vizcode_report":
            result = _tool_report(str(self._report_path))
        else:
            result = f"Unknown tool: {name}"
        clipped = _clip_text(str(result), budget, name)
        _append_query_log(self._root, {
            "ts": time.time(),
            "kind": "tool_call",
            "tool": name,
            "input_hash": _hash_payload(args or {}),
            "question_hash": _hash_payload(args.get("question", "")) if args.get("question") else "",
            "result_chars": len(clipped),
            "approx_tokens": max(1, len(clipped) // _CHARS_PER_TOKEN) if clipped else 0,
            "nodes_returned": _nodes_from_text(clipped),
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            "budget_chars": budget,
        })
        return clipped

    @staticmethod
    def definitions(whitelist: set[str] | None = None) -> list[dict]:
        """Return merged analysis + UI tool schemas (MCP inputSchema style).

        When `whitelist` is provided, only tools whose names are in the set are
        returned — used by mode-based tool filtering.
        """
        defs = list(MCP_TOOL_SCHEMAS) + list(UI_TOOL_SCHEMAS)
        if whitelist is None:
            return defs
        return [d for d in defs if d.get("name") in whitelist]


# ─── ContextInjector ──────────────────────────────────────────────────────────

class ContextInjector:
    """Build a system prompt summarising the current project."""

    def build(self, project_root: str, scan_path: str, addendum: str = "") -> str:
        root_name = Path(project_root).name or "project"
        scan = _load_json(scan_path)
        entries = scan.get("entries", {})
        n_files = len(entries)
        n_funcs = sum(
            len((e.get("payload") or {}).get("funcdefs") or [])
            for e in entries.values()
        )
        # Language distribution
        from collections import Counter
        import os.path
        ext_counts: Counter = Counter()
        for key in entries:
            ext = os.path.splitext(key)[1]
            if ext:
                ext_counts[ext] += 1
        top_langs = ", ".join(
            f"{ext}({cnt})" for ext, cnt in ext_counts.most_common(4)
        )

        return (
            f"You are VizCode AI — an expert codebase analyst embedded in "
            f"VizCode's visualization tool.\n\n"
            f"Current project: **{root_name}**\n"
            f"- Files: {n_files} | Functions: {n_funcs}\n"
            f"- Languages: {top_langs or 'unknown'}\n\n"
            f"You have two kinds of tools:\n\n"
            f"**Analysis tools** (read-only):\n"
            f"0. `vizcode_context(question)` — START HERE for almost any question. One call "
            f"returns a compact, centrality-ranked subgraph of the most relevant symbols "
            f"(signatures, docstrings, key call edges) and inlines a trace for "
            f"'how does X reach Y' questions. Usually you need nothing else.\n"
            f"1. `vizcode_l0()` — full module overview (only for explicit big-picture questions).\n"
            f"2. `vizcode_l1(module)` — drill into a specific module.\n"
            f"3. `vizcode_l2(file)` — function call graph for a specific file.\n"
            f"4. `vizcode_l3(file)` — detailed symbols, members, signatures, and symbol edges.\n"
            f"   Plus: `vizcode_trace(source, target)` (inline-code dependency trace), "
            f"`vizcode_affected(target)`, `vizcode_query`, `vizcode_path`, `vizcode_explain`, "
            f"`vizcode_health`, `vizcode_report`.\n\n"
            f"**Canvas tools** (drive the visualizer — web UI only):\n"
            f"- `vizcode_ui_goto_l0/l1/l2` — switch the user's canvas view\n"
            f"- `vizcode_ui_highlight_node(node_id)` — highlight a single node\n"
            f"- `vizcode_ui_highlight_nodes(node_ids[])` — highlight several nodes at once\n"
            f"- `vizcode_ui_highlight_path(source, target)` — highlight a dependency path\n"
            f"- `vizcode_ui_emit_badge(node_id, label)` — make a name in your reply clickable\n"
            f"- `vizcode_ui_tour_step(node_id, caption?)` — pan camera + show subtitle beside a node\n\n"
            f"Node id format: file paths as shown by `vizcode_l1` (e.g. `ai/vizbridge.py`). "
            f"For L2/L3 function nodes use `path::func`. Call `vizcode_l1` / `vizcode_l2` first "
            f"if you are not certain of the exact id — do not guess.\n\n"
            f"Rules:\n"
            f"- Reply in the same language as the user's most recent message unless the user explicitly asks for another language.\n"
            f"- If the request is ambiguous or the available tool results are insufficient, say what is missing and ask a focused follow-up question instead of guessing.\n"
            f"- If you are unsure which module / file / symbol the user means, ask briefly before choosing one.\n"
            f"- Start with `vizcode_context(question)`; it usually answers in one call. "
            f"Use `vizcode_l0()` / l1 / l2 / l3 only for an explicit big-picture overview "
            f"or when `vizcode_context` reports it is missing detail.\n"
            f"- When the user asks to 'see / show / open / go to / highlight' "
            f"something, call the matching `vizcode_ui_*` tool so the canvas "
            f"actually moves — do NOT just describe what they would see.\n"
            f"- Do NOT call canvas tools for pure Q&A (e.g. 'which module is biggest?').\n"
            f"- Generate flowcharts as a ```vizflow JSON block ({{nodes, edges}}) when asked to "
            f"visualize flows that aren't already shown on the canvas; the chat panel renders it "
            f"natively (a Mermaid ```flowchart block is also accepted and drawn the same way).\n"
            f"- Focus on architecture, dependencies, and call flows.\n"
            f"- Do NOT read raw source files — use the tools instead.\n"
            f"- Never fabricate missing facts, node ids, tool outputs, or code structure details.\n"
            f"- Be concise; the user can see the graph while chatting.\n\n"
            f"INTERACTIVE CHAT CONVENTIONS (important for UX):\n"
            f"- Whenever you mention a file or function that exists in the project, call "
            f"`vizcode_ui_emit_badge` FIRST (with the exact node_id and the label you will "
            f"write), then write the label in the very next sentence. The frontend wraps "
            f"the first matching occurrence of `label` as a clickable badge.\n"
            f"- Use `vizcode_ui_highlight_nodes` (plural) when discussing a group of files "
            f"that share a property (e.g. 'these three modules are tightly coupled').\n"
            f"- For guided walkthroughs, use `vizcode_ui_tour_step` WITH PACING: write one "
            f"sentence about node A, call tour_step(A, caption), write the next sentence "
            f"about node B, call tour_step(B, caption). NEVER batch tour steps at the end; "
            f"the rhythm between narration and camera movement is the whole point."
            + (addendum or "")
        )


# ─── VizBridge ────────────────────────────────────────────────────────────────

class VizBridge:
    """
    Main entry point.  Drives the tool-use loop for one conversation turn.

    Usage::

        vb = VizBridge(project_root)
        for event in vb.stream_response(messages):
            # event: {"type": "delta"|"tool_call"|"done"|"error", ...}
            send_sse(event)
    """

    _MAX_TOOL_ROUNDS = 6   # safety cap on autonomous tool calls per turn

    def __init__(self, project_root: str):
        self._root    = project_root
        self._cfg     = load_config()
        self._tools   = ToolRegistry(project_root)
        self._context = ContextInjector()

    def stream_response(
        self,
        messages: list[dict],
        depth:  str | None = None,
        output: str | None = None,
    ) -> Iterator[dict]:
        """
        Drive one conversation turn with automatic tool-use loop.

        `depth`  — reply thoroughness: "general" / "deep" / "quick".
        `output` — optional format constraint: "flow" / "file_tour" / "health_report".
        Quick depth ignores output. Unknown values fall back silently.

        Yields event dicts:
          {"type": "delta",     "text": "..."}
          {"type": "provider",  "name": "..."}
          {"type": "tool_call", "name": "...", "result": "..."}
          {"type": "ui_action", "action": "...", "args": {...}}
          {"type": "done"}
          {"type": "error",     "message": "..."}
        """
        # ── DEBUG LOG ────────────────────────────────────────────────────────
        _mode = (self._cfg.get('ai_mode') or 'api').lower()
        _p = self._cfg.get('provider', '?')
        _cli = self._cfg.get('cli_agent', '?')
        _k = self._cfg.get(f'{_p}_api_key', '') or self._cfg.get('ollama_url', '')
        print(f'[VizBridge.stream_response] called  mode={_mode}  provider={_p}  cli={_cli}  key_present={bool(_k)}  msgs={len(messages)}  depth={depth!r}  output={output!r}')
        import sys; sys.stdout.flush()
        # ─────────────────────────────────────────────────────────────────────
        if _mode == "cli":
            from ai.cli_runtime import CliRuntime
            provider = CliRuntime(self._cfg)
            yield {"type": "provider", "name": provider.provider_name}
        else:
            try:
                provider = ProviderRouter(self._cfg).get_provider()
                yield {"type": "provider", "name": self._cfg.get("provider")}
            except ValueError as e:
                print(f'[VizBridge.stream_response] provider error: {e}')
                yield {"type": "error", "message": str(e)}
                return

        # Resolve depth + output into operational chat limits.
        mode_spec = _resolve_mode_spec(depth, output)
        whitelist = mode_spec["tool_whitelist"]
        addendum = mode_spec["system_addendum"]
        max_tokens = int(mode_spec["max_tokens"])
        max_tool_rounds = int(mode_spec["max_tool_rounds"])
        # Cap per-tool result size to the active token budget so e.g. quick mode never
        # receives an oversized blob (adaptive budgets only ever scale up from baseline).
        self._tools.set_token_ceiling(max_tokens)
        if _mode == "cli":
            max_tool_rounds = min(max_tool_rounds, 2)
            ui_names = set(UI_TOOL_NAMES)
            if whitelist is None:
                whitelist = {
                    d.get("name", "")
                    for d in (list(MCP_TOOL_SCHEMAS) + list(UI_TOOL_SCHEMAS))
                    if d.get("name") not in ui_names
                }
            else:
                whitelist = set(whitelist) - ui_names

        scan_path = str(Path(self._root) / ".vizcode" / "scan_cache.json")
        system    = self._context.build(self._root, scan_path, addendum=addendum)
        tool_defs = self._tools.definitions(whitelist=whitelist)

        # Working copy of messages — we append assistant + tool_result turns
        working = _trim_working_history(list(messages))
        produced_text = False

        for _round in range(max_tool_rounds):
            working = _trim_working_history(working)
            # CLI agents emit protocol lines from the prompt, not via a tools API, so on
            # the final round we drop the tool schemas and tell the agent to answer
            # directly — otherwise it can spend its last turn on another tool request and
            # leave the user with an empty reply ("no response").
            is_last_round = (_round == max_tool_rounds - 1)
            if _mode == "cli" and is_last_round:
                round_tool_defs: list[dict] = []
                round_system = system + _CLI_FINAL_TURN_HINT
            else:
                round_tool_defs = tool_defs
                round_system = system
            pending_tool_calls: list[dict] = []
            assistant_content:  list[dict] = []
            ui_results: dict[str, str] = {}   # tool_use id -> result for UI tools already fired mid-stream
            synthetic_tool_blobs: list[str] = []
            text_buf = ""

            for ev in provider.stream_chat(working, round_tool_defs, round_system, max_tokens=max_tokens):
                if ev["type"] == "delta":
                    text_buf += ev["text"]
                    yield ev

                elif ev["type"] == "tool_use":
                    pending_tool_calls.append(ev)
                    if ev.get("synthetic") and ev.get("source_text"):
                        synthetic_tool_blobs.append(str(ev["source_text"]))
                    assistant_content.append({
                        "type":  "tool_use",
                        "id":    ev["id"],
                        "name":  ev["name"],
                        "input": ev["input"],
                    })
                    # Whitelist guard: AI shouldn't see out-of-mode tool schemas, but a
                    # replayed history or provider-side cache could surface one. Short-circuit
                    # with a deterministic error result instead of running the tool.
                    if whitelist is not None and ev["name"] not in whitelist:
                        block_msg = (
                            f"Tool {ev['name']!r} is not available in the current mode."
                        )
                        yield {
                            "type":   "tool_call",
                            "name":   ev["name"],
                            "input":  ev.get("input") or {},
                            "result": block_msg,
                        }
                        ui_results[ev["id"]] = block_msg
                        continue
                    # UI tools fire IMMEDIATELY so the canvas moves in sync with narration.
                    # The tool_result message still gets paired in `working` after the stream
                    # ends, keeping the provider's tool-use/tool-result contract intact.
                    if ev["name"] in UI_TOOL_NAMES:
                        ui = ui_dispatch(ev["name"], ev.get("input") or {})
                        yield {
                            "type":   "ui_action",
                            "action": ui["action"],
                            "args":   ui["args"],
                        }
                        yield {
                            "type":   "tool_call",
                            "name":   ev["name"],
                            "input":  ev.get("input") or {},
                            "result": ui["message"],
                        }
                        ui_results[ev["id"]] = ui["message"]

                elif ev["type"] == "done":
                    break

                elif ev["type"] == "error":
                    yield ev
                    return

                elif ev["type"] == "status":
                    yield ev

            # Append text to assistant content if any
            for blob in synthetic_tool_blobs:
                text_buf = text_buf.replace(blob, "")
            text_buf = text_buf.strip()
            if text_buf:
                produced_text = True
                assistant_content.insert(0, {"type": "text", "text": text_buf})

            if assistant_content:
                working.append({"role": "assistant", "content": assistant_content})

            # If no tool calls, we're done
            if not pending_tool_calls:
                yield {"type": "done"}
                return

            # Pair every tool_use with a tool_result for the next round.
            # UI tools already ran mid-stream; analysis tools run now.
            for tc in pending_tool_calls:
                if tc["id"] in ui_results:
                    result = ui_results[tc["id"]]
                else:
                    yield {
                        "type": "status",
                        "message": f"Running tool {tc['name']}...",
                    }
                    result = self._tools.call(tc["name"], tc["input"])
                    yield {
                        "type":   "tool_call",
                        "name":   tc["name"],
                        "input":  tc["input"],
                        "result": result,
                    }
                working.append({
                    "role":        "tool",
                    "tool_name":   tc["name"],
                    "tool_use_id": tc["id"],
                    "content":     result,
                })
            working = _trim_working_history(working)

        # Safety: exceeded max rounds. In CLI mode the agent may have spent every round
        # on tool requests without ever answering — force one final tool-free pass so the
        # user gets prose instead of an empty bubble ("no response").
        if _mode == "cli" and not produced_text:
            working = _trim_working_history(working)
            got_final = False
            for ev in provider.stream_chat(working, [], system + _CLI_FINAL_TURN_HINT,
                                           max_tokens=max_tokens):
                if ev["type"] == "delta":
                    got_final = True
                    yield ev
                elif ev["type"] == "error":
                    yield ev
                    break
                elif ev["type"] == "done":
                    break
                # ignore any further tool_use in this forced answer-only pass
            if not got_final:
                yield {
                    "type": "delta",
                    "text": (
                        "The local CLI agent finished without producing an answer. "
                        "Try a simpler question, switch depth to 'general', or use API mode."
                    ),
                }

        yield {"type": "done"}
