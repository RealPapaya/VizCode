"""
ai/vizbridge.py — VizBridge core engine.

Orchestrates AI chat over the VizCode codebase:
  - ToolRegistry   : wraps the 8 vizcode_* tools (reads .local/ cache directly)
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
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

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

# ─── Config ───────────────────────────────────────────────────────────────────

_CONFIG_PATH = _HERE / "config.json"

_DEFAULTS: dict = {
    "provider":           "anthropic",
    "anthropic_api_key":  "",
    "anthropic_model":    "claude-sonnet-4-6",
    "openai_api_key":     "",
    "openai_model":       "gpt-4o",
    "gemini_api_key":     "",
    "gemini_model":       "gemini-2.0-flash",
    "ollama_url":         "http://localhost:11434",
    "ollama_model":       "llama3.1",
}


def load_config() -> dict:
    """Merge ai/config.json with defaults.  Returns a copy."""
    cfg = dict(_DEFAULTS)
    if _CONFIG_PATH.is_file():
        try:
            cfg.update(json.loads(_CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    # Environment variable overrides
    if os.environ.get("ANTHROPIC_API_KEY"):
        cfg["anthropic_api_key"] = os.environ["ANTHROPIC_API_KEY"]
        cfg.setdefault("provider", "anthropic")
    if os.environ.get("OPENAI_API_KEY"):
        cfg["openai_api_key"] = os.environ["OPENAI_API_KEY"]
    if os.environ.get("GEMINI_API_KEY"):
        cfg["gemini_api_key"] = os.environ["GEMINI_API_KEY"]
    return cfg


def save_config(updates: dict) -> None:
    """Merge updates into ai/config.json (creates file if absent)."""
    cfg = load_config()
    cfg.update(updates)
    # Strip fields that equal defaults to keep file minimal
    to_write = {k: v for k, v in cfg.items() if v != _DEFAULTS.get(k, "")}
    _CONFIG_PATH.write_text(
        json.dumps(to_write, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def masked_config() -> dict:
    """Return config safe to expose to the browser (mask API keys)."""
    cfg = load_config()
    out = dict(cfg)
    for key in ("anthropic_api_key", "openai_api_key", "gemini_api_key"):
        val = cfg.get(key, "")
        if val and len(val) > 8:
            out[key] = val[:4] + "****" + val[-4:]
        elif val:
            out[key] = "****"
    return out


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

        # Phase 2 providers — stubs that give a friendly error until implemented
        if provider in ("openai", "gemini", "ollama"):
            raise ValueError(
                f"Provider '{provider}' is not yet implemented. "
                "Currently only 'anthropic' is supported."
            )

        raise ValueError(f"Unknown provider: {provider!r}")


# ─── ToolRegistry ─────────────────────────────────────────────────────────────

class ToolRegistry:
    """
    Wraps the 8 vizcode_* tool implementations from mcp_server.py.
    Loads .local/scan_cache.json lazily on first call.
    """

    def __init__(self, project_root: str):
        self._root = Path(project_root)
        self._scan_path = self._root / ".local" / "scan_cache.json"
        self._sem_path  = self._root / ".local" / "semantic_cache.json"
        self._report_path = self._root / ".local" / "vizcode_report.md"
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
    def definitions() -> list[dict]:
        """Return tool schemas (Anthropic input_schema format)."""
        return MCP_TOOL_SCHEMAS


# ─── ContextInjector ──────────────────────────────────────────────────────────

class ContextInjector:
    """Build a system prompt summarising the current project."""

    def build(self, project_root: str, scan_path: str) -> str:
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
            f"You have access to 8 tools to explore this codebase. "
            f"Use them hierarchically:\n"
            f"1. `vizcode_l0()` — understand overall module structure first\n"
            f"2. `vizcode_l1(module)` — drill into a specific module\n"
            f"3. `vizcode_l2(file)` — see function call graph for a specific file\n\n"
            f"Rules:\n"
            f"- ALWAYS start with `vizcode_l0()` for broad codebase questions\n"
            f"- Generate Mermaid flowcharts (```mermaid) when asked to visualize flows\n"
            f"- Focus on architecture, dependencies, and call flows\n"
            f"- Do NOT read raw source files — use the tools instead\n"
            f"- Be concise; the user can see the graph while chatting"
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

    def stream_response(self, messages: list[dict]) -> Iterator[dict]:
        """
        Drive one conversation turn with automatic tool-use loop.

        Yields event dicts:
          {"type": "delta",     "text": "..."}
          {"type": "tool_call", "name": "...", "result": "..."}
          {"type": "done"}
          {"type": "error",     "message": "..."}
        """
        try:
            provider = ProviderRouter(self._cfg).get_provider()
        except ValueError as e:
            yield {"type": "error", "message": str(e)}
            return

        scan_path = str(Path(self._root) / ".local" / "scan_cache.json")
        system    = self._context.build(self._root, scan_path)
        tool_defs = self._tools.definitions()

        # Working copy of messages — we append assistant + tool_result turns
        working = list(messages)

        for _round in range(self._MAX_TOOL_ROUNDS):
            pending_tool_calls: list[dict] = []
            assistant_content:  list[dict] = []
            text_buf = ""

            for ev in provider.stream_chat(working, tool_defs, system):
                if ev["type"] == "delta":
                    text_buf += ev["text"]
                    yield ev

                elif ev["type"] == "tool_use":
                    pending_tool_calls.append(ev)
                    assistant_content.append({
                        "type":  "tool_use",
                        "id":    ev["id"],
                        "name":  ev["name"],
                        "input": ev["input"],
                    })

                elif ev["type"] == "done":
                    break

                elif ev["type"] == "error":
                    yield ev
                    return

            # Append text to assistant content if any
            if text_buf:
                assistant_content.insert(0, {"type": "text", "text": text_buf})

            if assistant_content:
                working.append({"role": "assistant", "content": assistant_content})

            # If no tool calls, we're done
            if not pending_tool_calls:
                yield {"type": "done"}
                return

            # Execute tools and append results
            for tc in pending_tool_calls:
                result = self._tools.call(tc["name"], tc["input"])
                yield {
                    "type":   "tool_call",
                    "name":   tc["name"],
                    "input":  tc["input"],
                    "result": result,
                }
                working.append({
                    "role":        "tool",
                    "tool_use_id": tc["id"],
                    "content":     result,
                })

        # Safety: exceeded max rounds
        yield {"type": "done"}
