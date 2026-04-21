"""
ai/providers/openai_provider.py — OpenAI (and Azure OpenAI) provider for VizBridge.

Uses urllib.request (stdlib only) to call the OpenAI chat completions API with
streaming enabled.  Handles parallel tool_calls in one assistant turn.

Also supports Azure OpenAI endpoints via the `base_url` parameter:
    base_url = "https://<resource>.openai.azure.com/openai/deployments/<deployment>"
    api_version = "2024-08-01-preview"
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Iterator

from . import BaseProvider

# ─── Constants ────────────────────────────────────────────────────────────────

_API_URL     = "https://api.openai.com/v1/chat/completions"
_DEFAULT_MODEL = "gpt-4o"
_MAX_TOKENS  = 4096


# ─── OpenAIProvider ───────────────────────────────────────────────────────────

class OpenAIProvider(BaseProvider):

    def __init__(
        self,
        api_key: str,
        model: str = _DEFAULT_MODEL,
        base_url: str = "",
        api_version: str = "",
    ):
        self._api_key    = api_key
        self._model      = model or _DEFAULT_MODEL
        self._base_url   = base_url.rstrip("/") if base_url else _API_URL
        self._api_version = api_version  # Azure only

    # ── Public ────────────────────────────────────────────────────────────────

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        oai_messages = _to_openai_messages(messages, system)
        oai_tools    = _to_openai_tools(tools)

        url = self._base_url
        if self._api_version:
            url += f"?api-version={self._api_version}"

        body: dict = {
            "model":      self._model,
            "max_tokens": _MAX_TOKENS,
            "messages":   oai_messages,
            "stream":     True,
        }
        if oai_tools:
            body["tools"] = oai_tools

        try:
            yield from self._stream(url, body)
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8")
                err_json = json.loads(err_body)
                error_obj = err_json.get("error") or {}
                msg = (error_obj.get("message") if isinstance(error_obj, dict) else str(error_obj)) or err_body
            except Exception:
                msg = err_body or str(e)
            yield {"type": "error", "message": f"API error {e.code}: {msg}"}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    # ── Private ───────────────────────────────────────────────────────────────

    def _stream(self, url: str, body: dict) -> Iterator[dict]:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {self._api_key}",
            "Accept":        "text/event-stream",
            "User-Agent":    "VizCode/1.0",
        }
        # Azure uses api-key header instead of Authorization
        if self._api_version:
            headers["api-key"] = self._api_key
            del headers["Authorization"]

        req = urllib.request.Request(url, data=raw, method="POST", headers=headers)

        # Accumulate tool call deltas: {index: {id, name, arguments_buf}}
        tool_calls: dict[int, dict] = {}

        with urllib.request.urlopen(req, timeout=60) as resp:
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n\n" in buf:
                    raw_event, buf = buf.split(b"\n\n", 1)
                    for line in raw_event.decode("utf-8").splitlines():
                        if not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            # Flush any complete tool calls
                            for idx in sorted(tool_calls):
                                tc = tool_calls[idx]
                                try:
                                    input_obj = json.loads(tc["arguments_buf"] or "{}")
                                except json.JSONDecodeError:
                                    input_obj = {}
                                yield {
                                    "type":  "tool_use",
                                    "id":    tc["id"],
                                    "name":  tc["name"],
                                    "input": input_obj,
                                }
                            tool_calls.clear()
                            yield {"type": "done"}
                            return
                        if not data_str:
                            continue
                        try:
                            ev = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        for choice in ev.get("choices", []):
                            delta = choice.get("delta", {})

                            # Text delta
                            content = delta.get("content")
                            if content:
                                yield {"type": "delta", "text": content}

                            # Tool call delta (may be streamed in fragments)
                            for tc_delta in (delta.get("tool_calls") or []):
                                idx = tc_delta.get("index", 0)
                                if idx not in tool_calls:
                                    tool_calls[idx] = {"id": "", "name": "", "arguments_buf": ""}
                                entry = tool_calls[idx]
                                if tc_delta.get("id"):
                                    entry["id"] = tc_delta["id"]
                                fn = tc_delta.get("function", {})
                                if fn.get("name"):
                                    entry["name"] += fn["name"]
                                if fn.get("arguments"):
                                    entry["arguments_buf"] += fn["arguments"]

        yield {"type": "done"}


# ─── Format converters ────────────────────────────────────────────────────────

def _to_openai_messages(messages: list[dict], system: str) -> list[dict]:
    """Convert VizBridge generic messages to OpenAI chat format."""
    result: list[dict] = [{"role": "system", "content": system}]
    for msg in messages:
        role = msg["role"]
        if role == "user":
            result.append({"role": "user", "content": str(msg["content"])})
        elif role == "assistant":
            content = msg.get("content", [])
            if isinstance(content, str):
                result.append({"role": "assistant", "content": content})
            else:
                # Build assistant message with optional tool_calls
                text_parts = [c["text"] for c in content if c.get("type") == "text"]
                tool_calls = []
                for c in content:
                    if c.get("type") == "tool_use":
                        tool_calls.append({
                            "id":       c["id"],
                            "type":     "function",
                            "function": {
                                "name":      c["name"],
                                "arguments": json.dumps(c["input"], ensure_ascii=False),
                            },
                        })
                oai_msg: dict = {"role": "assistant"}
                if text_parts:
                    oai_msg["content"] = " ".join(text_parts)
                if tool_calls:
                    oai_msg["tool_calls"] = tool_calls
                result.append(oai_msg)
        elif role == "tool":
            result.append({
                "role":         "tool",
                "tool_call_id": msg["tool_use_id"],
                "content":      str(msg["content"]),
            })
    return result


def _to_openai_tools(tools: list[dict]) -> list[dict]:
    """Convert VizBridge tool schemas (Anthropic format) to OpenAI function format."""
    out = []
    for t in tools:
        out.append({
            "type": "function",
            "function": {
                "name":        t["name"],
                "description": t.get("description", ""),
                "parameters":  t.get("inputSchema", {"type": "object", "properties": {}}),
            },
        })
    return out
