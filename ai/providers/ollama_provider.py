"""
ai/providers/ollama_provider.py — Ollama (local LLM) provider for VizBridge.

Calls the Ollama /api/chat endpoint, which uses an OpenAI-compatible message
format and returns newline-delimited JSON (NDJSON) when streaming.

Tool calling requires a model that supports it (e.g. llama3.1, mistral-nemo,
qwen2.5, command-r).  If the model does not support tools, tool_calls will
simply never appear and the AI will answer with plain text only.

No API key required — Ollama runs locally.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Iterator

from . import BaseProvider

# ─── Constants ────────────────────────────────────────────────────────────────

_CHAT_PATH    = "/api/chat"
_DEFAULT_URL  = "http://localhost:11434"
_DEFAULT_MODEL = "llama3.1"


# ─── OllamaProvider ───────────────────────────────────────────────────────────

class OllamaProvider(BaseProvider):

    def __init__(self, url: str = _DEFAULT_URL, model: str = _DEFAULT_MODEL):
        self._base_url = url.rstrip("/")
        self._model    = model or _DEFAULT_MODEL

    # ── Public ────────────────────────────────────────────────────────────────

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        ollama_messages = _to_ollama_messages(messages, system)
        ollama_tools    = _to_ollama_tools(tools)

        body: dict = {
            "model":    self._model,
            "messages": ollama_messages,
            "stream":   True,
        }
        if ollama_tools:
            body["tools"] = ollama_tools

        try:
            yield from self._stream(body)
        except urllib.error.URLError as e:
            yield {
                "type":    "error",
                "message": (
                    f"Cannot connect to Ollama at {self._base_url}. "
                    f"Is it running?  (ollama serve)  Details: {e.reason}"
                ),
            }
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    # ── Private ───────────────────────────────────────────────────────────────

    def _stream(self, body: dict) -> Iterator[dict]:
        url = self._base_url + _CHAT_PATH
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=raw, method="POST",
            headers={"Content-Type": "application/json"},
        )

        with urllib.request.urlopen(req) as resp:
            for line in resp:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line.decode("utf-8"))
                except json.JSONDecodeError:
                    continue

                message = obj.get("message", {})
                role    = message.get("role", "")

                # Text content delta
                content = message.get("content", "")
                if content:
                    yield {"type": "delta", "text": content}

                # Tool calls (Ollama uses OpenAI-compatible format)
                for tc in (message.get("tool_calls") or []):
                    fn   = tc.get("function", {})
                    args = fn.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    yield {
                        "type":  "tool_use",
                        "id":    tc.get("id", fn.get("name", "")),
                        "name":  fn.get("name", ""),
                        "input": args,
                    }

                # Stream done
                if obj.get("done"):
                    break

        yield {"type": "done"}


# ─── Format converters ────────────────────────────────────────────────────────

def _to_ollama_messages(messages: list[dict], system: str) -> list[dict]:
    """Convert VizBridge messages to Ollama (OpenAI-compatible) format."""
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
                text_parts = [c["text"] for c in content if c.get("type") == "text"]
                tool_calls = []
                for c in content:
                    if c.get("type") == "tool_use":
                        tool_calls.append({
                            "id":       c["id"],
                            "type":     "function",
                            "function": {
                                "name":      c["name"],
                                "arguments": json.dumps(c.get("input", {})),
                            },
                        })
                oai_msg: dict = {"role": "assistant", "content": " ".join(text_parts)}
                if tool_calls:
                    oai_msg["tool_calls"] = tool_calls
                result.append(oai_msg)
        elif role == "tool":
            result.append({
                "role":         "tool",
                "tool_call_id": msg.get("tool_use_id", ""),
                "content":      str(msg["content"]),
            })
    return result


def _to_ollama_tools(tools: list[dict]) -> list[dict]:
    """Convert VizBridge tool schemas to Ollama (OpenAI function) format."""
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
