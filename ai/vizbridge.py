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
import sys
from collections import deque
from pathlib import Path
from typing import Iterator

# ─── path bootstrap (allow running from project root) ────────────────────────
_HERE = Path(__file__).parent
_ROOT = _HERE.parent
_IMPORT_DIRS = (
    _ROOT,
    _ROOT / "src",
    _ROOT / "src" / "server",
    _ROOT / "src" / "core",
)
for _import_dir in _IMPORT_DIRS:
    _import_dir_str = str(_import_dir)
    if _import_dir_str not in sys.path:
        sys.path.insert(0, _import_dir_str)

# Import tool implementations from mcp_server (no MCP protocol needed)
from mcp_server import (
    _load_json,
    _build_index,
    _build_stem_index,
    _tool_l0,
    _tool_l1,
    _tool_l2,
    _tool_health,
    _tool_query,
    _tool_path,
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
from ai.chat_modes import resolve as _resolve_mode

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
        self._report_path = self._root / ".vizcode" / "report" / "vizcode_report.md"
        self._modules: dict | None = None
        self._edges:   list | None = None
        self._adj:     dict | None = None
        self._mod_to_files:  dict | None = None
        self._stem_to_key:   dict | None = None

    def _ensure_loaded(self) -> None:
        if self._modules is not None:
            return
        scan = _load_json(str(self._scan_path))
        sem  = _load_json(str(self._sem_path))
        self._modules, self._edges, self._adj = _build_index(scan, sem)
        self._mod_to_files, self._stem_to_key = _build_stem_index(self._modules)

    def call(self, name: str, args: dict) -> str:
        """Call a tool by name and return its Markdown result string."""
        self._ensure_loaded()
        m  = self._modules
        e  = self._edges
        a  = self._adj
        mf = self._mod_to_files
        sk = self._stem_to_key

        if name == "vizcode_l0":
            return _tool_l0(m, mf, sk)
        if name == "vizcode_l1":
            return _tool_l1(args.get("module", "."), m, mf, sk)
        if name == "vizcode_l2":
            return _tool_l2(args.get("file", ""), m)
        if name == "vizcode_query":
            return _tool_query(args.get("question", ""), m, e)
        if name == "vizcode_path":
            return _tool_path(args.get("source", ""), args.get("target", ""), m, a)
        if name == "vizcode_explain":
            return _tool_explain(args.get("symbol", ""), m, e)
        if name == "vizcode_health":
            return _tool_health(m, sk)
        if name == "vizcode_report":
            return _tool_report(str(self._report_path))
        return f"Unknown tool: {name}"

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
            f"**Analysis tools** (read-only, hierarchical):\n"
            f"1. `vizcode_l0()` — understand overall module structure first\n"
            f"2. `vizcode_l1(module)` — drill into a specific module\n"
            f"3. `vizcode_l2(file)` — see function call graph for a specific file\n"
            f"   Plus: `vizcode_query`, `vizcode_path`, `vizcode_explain`, "
            f"`vizcode_health`, `vizcode_report`.\n\n"
            f"**Canvas tools** (drive the visualizer — web UI only):\n"
            f"- `vizcode_ui_goto_l0/l1/l2` — switch the user's canvas view\n"
            f"- `vizcode_ui_highlight_node(node_id)` — highlight a single node\n"
            f"- `vizcode_ui_highlight_nodes(node_ids[])` — highlight several nodes at once\n"
            f"- `vizcode_ui_highlight_path(source, target)` — highlight a dependency path\n"
            f"- `vizcode_ui_emit_badge(node_id, label)` — make a name in your reply clickable\n"
            f"- `vizcode_ui_tour_step(node_id, caption?)` — pan camera + show subtitle beside a node\n\n"
            f"Node id format: file paths as shown by `vizcode_l1` (e.g. `ai/vizbridge.py`). "
            f"For L2 function nodes use `path::func`. Call `vizcode_l1` / `vizcode_l2` first "
            f"if you are not certain of the exact id — do not guess.\n\n"
            f"Rules:\n"
            f"- Reply in the same language as the user's most recent message unless the user explicitly asks for another language.\n"
            f"- If the request is ambiguous or the available tool results are insufficient, say what is missing and ask a focused follow-up question instead of guessing.\n"
            f"- If you are unsure which module / file / symbol the user means, ask briefly before choosing one.\n"
            f"- ALWAYS start with `vizcode_l0()` for broad codebase questions.\n"
            f"- When the user asks to 'see / show / open / go to / highlight' "
            f"something, call the matching `vizcode_ui_*` tool so the canvas "
            f"actually moves — do NOT just describe what they would see.\n"
            f"- Do NOT call canvas tools for pure Q&A (e.g. 'which module is biggest?').\n"
            f"- Generate Mermaid flowcharts (```mermaid) when asked to visualize flows "
            f"that aren't already shown on the canvas (the chat panel renders them inline).\n"
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
        `output` — optional format constraint: "mermaid_flow" / "file_tour" / "health_report".
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

        # Resolve depth + output into (tool whitelist, prompt addendum).
        whitelist, addendum = _resolve_mode(depth, output)

        scan_path = str(Path(self._root) / ".vizcode" / "scan_cache.json")
        system    = self._context.build(self._root, scan_path, addendum=addendum)
        tool_defs = self._tools.definitions(whitelist=whitelist)

        # Working copy of messages — we append assistant + tool_result turns
        working = list(messages)

        for _round in range(self._MAX_TOOL_ROUNDS):
            pending_tool_calls: list[dict] = []
            assistant_content:  list[dict] = []
            ui_results: dict[str, str] = {}   # tool_use id -> result for UI tools already fired mid-stream
            synthetic_tool_blobs: list[str] = []
            text_buf = ""

            for ev in provider.stream_chat(working, tool_defs, system):
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

        # Safety: exceeded max rounds
        yield {"type": "done"}
