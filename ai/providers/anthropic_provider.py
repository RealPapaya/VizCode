"""
ai/providers/anthropic_provider.py — Anthropic Claude provider for VizBridge.

Uses urllib.request (stdlib only) to call api.anthropic.com/v1/messages with
streaming enabled.  Handles tool_use / tool_result multi-turn loop internally.

Yields event dicts defined in ai/providers/__init__.py.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Iterator

from . import BaseProvider

# ─── Constants ────────────────────────────────────────────────────────────────

_API_URL = "https://api.anthropic.com/v1/messages"
_API_VERSION = "2023-06-01"
_DEFAULT_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS = 4096


# ─── AnthropicProvider ────────────────────────────────────────────────────────

class AnthropicProvider(BaseProvider):

    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL):
        self._api_key = api_key
        self._model = model or _DEFAULT_MODEL

    # ── Public ────────────────────────────────────────────────────────────────

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        """
        Yield event dicts for one turn.  Converts generic message format to
        Anthropic format and parses the SSE response stream.
        """
        anthropic_msgs = _to_anthropic_messages(messages)
        anthropic_tools = _to_anthropic_tools(tools)

        body = {
            "model":      self._model,
            "max_tokens": _MAX_TOKENS,
            "system":     system,
            "messages":   anthropic_msgs,
            "stream":     True,
        }
        if anthropic_tools:
            body["tools"] = anthropic_tools

        try:
            yield from self._stream(body)
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", err_body)
            except Exception:
                msg = str(e)
            yield {"type": "error", "message": f"Anthropic API error {e.code}: {msg}"}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    # ── Private ───────────────────────────────────────────────────────────────

    def _stream(self, body: dict) -> Iterator[dict]:
        """Call the Anthropic streaming API and parse SSE events."""
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            _API_URL,
            data=raw,
            method="POST",
            headers={
                "Content-Type":    "application/json",
                "x-api-key":       self._api_key,
                "anthropic-version": _API_VERSION,
                "Accept":          "text/event-stream",
            },
        )

        # Active tool_use block accumulator
        tool_block: dict | None = None
        tool_input_buf: str = ""

        with urllib.request.urlopen(req) as resp:
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                # SSE messages are separated by double newline
                while b"\n\n" in buf:
                    raw_event, buf = buf.split(b"\n\n", 1)
                    event_type = ""
                    data_str = ""
                    for line in raw_event.decode("utf-8").splitlines():
                        if line.startswith("event:"):
                            event_type = line[6:].strip()
                        elif line.startswith("data:"):
                            data_str = line[5:].strip()

                    if not data_str or data_str == "[DONE]":
                        continue

                    try:
                        ev = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    yield from self._handle_event(
                        ev, event_type,
                        tool_block_ref=[tool_block],
                        tool_input_buf_ref=[tool_input_buf],
                    )
                    # sync locals back (mutable via list refs)
                    tool_block = self._last_tool_block
                    tool_input_buf = self._last_tool_input_buf

        yield {"type": "done"}

    def _handle_event(
        self,
        ev: dict,
        event_type: str,
        tool_block_ref: list,
        tool_input_buf_ref: list,
    ) -> Iterator[dict]:
        """Parse one Anthropic SSE event and yield VizBridge events."""
        self._last_tool_block = tool_block_ref[0]
        self._last_tool_input_buf = tool_input_buf_ref[0]

        ev_type = ev.get("type", "")

        if ev_type == "content_block_start":
            block = ev.get("content_block", {})
            if block.get("type") == "tool_use":
                self._last_tool_block = {
                    "id":   block.get("id", ""),
                    "name": block.get("name", ""),
                }
                self._last_tool_input_buf = ""

        elif ev_type == "content_block_delta":
            delta = ev.get("delta", {})
            delta_type = delta.get("type", "")

            if delta_type == "text_delta":
                yield {"type": "delta", "text": delta.get("text", "")}

            elif delta_type == "input_json_delta":
                self._last_tool_input_buf += delta.get("partial_json", "")

        elif ev_type == "content_block_stop":
            if self._last_tool_block is not None:
                # Parse accumulated JSON input
                try:
                    tool_input = json.loads(self._last_tool_input_buf or "{}")
                except json.JSONDecodeError:
                    tool_input = {}
                yield {
                    "type":  "tool_use",
                    "id":    self._last_tool_block["id"],
                    "name":  self._last_tool_block["name"],
                    "input": tool_input,
                }
                self._last_tool_block = None
                self._last_tool_input_buf = ""

        elif ev_type == "message_stop":
            pass  # "done" yielded after loop ends

        elif ev_type == "error":
            err = ev.get("error", {})
            yield {"type": "error", "message": err.get("message", str(ev))}


# ─── Format converters ────────────────────────────────────────────────────────

def _to_anthropic_messages(messages: list[dict]) -> list[dict]:
    """
    Convert generic VizBridge messages to Anthropic format.

    Generic format:
      {"role": "user",      "content": "text..."}
      {"role": "assistant", "content": [{"type": "text", "text": "..."},
                                         {"type": "tool_use", ...}]}
      {"role": "tool",      "tool_use_id": "...", "content": "result text"}

    Anthropic format collapses consecutive tool results into one user message.
    """
    result: list[dict] = []
    for msg in messages:
        role = msg["role"]
        if role == "user":
            result.append({"role": "user", "content": str(msg["content"])})
        elif role == "assistant":
            content = msg.get("content", [])
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            result.append({"role": "assistant", "content": content})
        elif role == "tool":
            # Tool results must be batched as a single user message with list content
            tool_result_block = {
                "type":        "tool_result",
                "tool_use_id": msg["tool_use_id"],
                "content":     str(msg["content"]),
            }
            # Merge with preceding user message if it already holds tool_results
            if result and result[-1]["role"] == "user" and isinstance(result[-1]["content"], list):
                result[-1]["content"].append(tool_result_block)
            else:
                result.append({"role": "user", "content": [tool_result_block]})
    return result


def _to_anthropic_tools(tools: list[dict]) -> list[dict]:
    """Convert VizBridge tool schema (Anthropic-native format) — no conversion needed."""
    out = []
    for t in tools:
        out.append({
            "name":         t["name"],
            "description":  t.get("description", ""),
            "input_schema": t.get("inputSchema", {"type": "object", "properties": {}}),
        })
    return out
