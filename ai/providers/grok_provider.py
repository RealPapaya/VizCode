"""
ai/providers/grok_provider.py — xAI Grok provider for VizBridge.

Uses urllib.request (stdlib only) to call xAI's OpenAI-compatible chat
completions endpoint with streaming enabled. Handles parallel tool_calls in one
assistant turn.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Iterator

from . import BaseProvider

# Reuse the OpenAI-format converters because xAI documents the endpoint as
# OpenAI REST API compatible.
from .openai_provider import _to_openai_messages, _to_openai_tools

_API_URL = "https://api.x.ai/v1/chat/completions"
_DEFAULT_MODEL = "grok-4.20"
_MAX_TOKENS = 4096


class GrokProvider(BaseProvider):

    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL):
        self._api_key = api_key
        self._model = model or _DEFAULT_MODEL

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        grok_messages = _to_openai_messages(messages, system)
        grok_tools = _to_openai_tools(tools)

        body: dict = {
            "model": self._model,
            "max_tokens": _MAX_TOKENS,
            "messages": grok_messages,
            "stream": True,
        }
        if grok_tools:
            body["tools"] = grok_tools

        try:
            yield from self._stream(_API_URL, body)
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", err_body)
            except Exception:
                msg = str(e)
            yield {"type": "error", "message": f"Grok API error {e.code}: {msg}"}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    def _stream(self, url: str, body: dict) -> Iterator[dict]:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "text/event-stream",
        }
        req = urllib.request.Request(url, data=raw, method="POST", headers=headers)

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
                            for idx in sorted(tool_calls):
                                tc = tool_calls[idx]
                                try:
                                    input_obj = json.loads(tc["arguments_buf"] or "{}")
                                except json.JSONDecodeError:
                                    input_obj = {}
                                yield {
                                    "type": "tool_use",
                                    "id": tc["id"],
                                    "name": tc["name"],
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

                            content = delta.get("content")
                            if content:
                                yield {"type": "delta", "text": content}

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
