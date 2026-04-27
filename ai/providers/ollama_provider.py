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

import ast
import json
import re
import socket
import urllib.request
import urllib.error
from json import JSONDecodeError
from typing import Iterator

from . import BaseProvider
from ._errors import format_http_error, format_url_error

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
        tool_names      = {t.get("name", "") for t in tools if t.get("name")}

        body: dict = {
            "model":    self._model,
            "messages": ollama_messages,
            "stream":   True,
        }
        if ollama_tools:
            body["tools"] = ollama_tools

        try:
            yield from self._stream(body, tool_names)
        except urllib.error.HTTPError as e:
            yield {"type": "error", "message": format_http_error(e, "Ollama")}
        except (urllib.error.URLError, socket.timeout) as e:
            base = format_url_error(e, self._base_url, "Ollama")
            yield {"type": "error", "message": f"{base}  Is it running? (ollama serve)"}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    # ── Private ───────────────────────────────────────────────────────────────

    def _stream(self, body: dict, tool_names: set[str]) -> Iterator[dict]:
        url = self._base_url + _CHAT_PATH
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=raw, method="POST",
            headers={"Content-Type": "application/json"},
        )

        text_chunks: list[str] = []
        pending_text_chunks: list[str] = []
        saw_native_tool_call = False
        streaming_text_enabled = False

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
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
                        text_chunks.append(content)
                        if streaming_text_enabled:
                            yield {"type": "delta", "text": content}
                        else:
                            pending_text_chunks.append(content)

                    # Tool calls (Ollama uses OpenAI-compatible format)
                    for tc in (message.get("tool_calls") or []):
                        saw_native_tool_call = True
                        if not streaming_text_enabled and pending_text_chunks:
                            for chunk in pending_text_chunks:
                                yield {"type": "delta", "text": chunk}
                            pending_text_chunks.clear()
                            streaming_text_enabled = True
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
        except urllib.error.HTTPError as exc:
            if exc.code == 400:
                preview = raw.decode("utf-8", errors="replace")
                print("[OllamaProvider] HTTP 400 request preview:")
                print(preview[:4000])
            raise

        if not saw_native_tool_call and tool_names:
            synthetic_calls = _extract_textual_tool_calls("".join(text_chunks), tool_names)
            if synthetic_calls:
                for i, call in enumerate(synthetic_calls, start=1):
                    yield {
                        "type":        "tool_use",
                        "id":          f"textual-tool-{i}-{call['name']}",
                        "name":        call["name"],
                        "input":       call["input"],
                        "synthetic":   True,
                        "source_text": call["source_text"],
                    }
            else:
                for chunk in pending_text_chunks:
                    yield {"type": "delta", "text": chunk}
        elif pending_text_chunks:
            for chunk in pending_text_chunks:
                yield {"type": "delta", "text": chunk}

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
                tool_index = 0
                for c in content:
                    if c.get("type") == "tool_use":
                        tool_input = c.get("input", {})
                        if not isinstance(tool_input, dict):
                            tool_input = {}
                        tool_calls.append({
                            "type": "function",
                            "function": {
                                "index":     tool_index,
                                "name":      c["name"],
                                "arguments": tool_input,
                            },
                        })
                        tool_index += 1
                oai_msg: dict = {"role": "assistant", "content": " ".join(text_parts)}
                if tool_calls:
                    oai_msg["tool_calls"] = tool_calls
                result.append(oai_msg)
        elif role == "tool":
            tool_name = msg.get("tool_name", "")
            if not tool_name and msg.get("tool_use_id"):
                tool_name = str(msg.get("tool_use_id", ""))
            result.append({
                "role":      "tool",
                "tool_name": tool_name,
                "content":   str(msg["content"]),
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


def _extract_textual_tool_calls(text: str, tool_names: set[str]) -> list[dict]:
    """
    Fallback for models that describe a tool call in plain text / JSON instead
    of using Ollama's native tool_calls field.
    """
    if not text.strip():
        return []

    decoder = json.JSONDecoder()
    calls: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for start, ch in enumerate(text):
        if ch not in "{[":
            continue
        try:
            obj, end_rel = decoder.raw_decode(text[start:])
        except JSONDecodeError:
            continue
        for name, args in _coerce_textual_tool_calls(obj, tool_names):
            sig = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
            if sig in seen:
                continue
            seen.add(sig)
            calls.append({
                "name": name,
                "input": args,
                "source_text": text[start:start + end_rel],
            })

    for name, args, source_text in _extract_inline_tool_calls(text, tool_names):
        sig = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
        if sig in seen:
            continue
        seen.add(sig)
        calls.append({
            "name": name,
            "input": args,
            "source_text": source_text,
        })

    return calls


def _coerce_textual_tool_calls(obj: object, tool_names: set[str]) -> list[tuple[str, dict]]:
    if isinstance(obj, list):
        out: list[tuple[str, dict]] = []
        for item in obj:
            out.extend(_coerce_textual_tool_calls(item, tool_names))
        return out

    if not isinstance(obj, dict):
        return []

    name = obj.get("name") or obj.get("tool")
    args = obj.get("parameters", obj.get("arguments", obj.get("input")))

    fn = obj.get("function")
    if isinstance(fn, dict):
        name = fn.get("name") or name
        args = fn.get("arguments", args)

    if not isinstance(name, str) or name not in tool_names:
        return []

    if isinstance(args, str):
        try:
            args = json.loads(args)
        except JSONDecodeError:
            return []

    if not isinstance(args, dict):
        return []

    return [(name, args)]


def _extract_inline_tool_calls(text: str, tool_names: set[str]) -> list[tuple[str, dict, str]]:
    if not text.strip() or not tool_names:
        return []

    name_pat = "|".join(re.escape(name) for name in sorted(tool_names, key=len, reverse=True))
    pattern = re.compile(rf"(?P<call>(?P<name>{name_pat})\s*\((?P<args>[^()]*)\))")
    out: list[tuple[str, dict, str]] = []
    seen_spans: set[tuple[int, int]] = set()

    for match in pattern.finditer(text):
        span = match.span("call")
        if span in seen_spans:
            continue
        parsed_args = _parse_inline_call(match.group("call"), match.group("name"))
        if parsed_args is None:
            continue
        seen_spans.add(span)
        out.append((match.group("name"), parsed_args, match.group("call")))

    return out


def _parse_inline_call(call_text: str, expected_name: str) -> dict | None:
    try:
        expr = ast.parse(call_text.strip(), mode="eval").body
    except SyntaxError:
        return None

    if not isinstance(expr, ast.Call):
        return None
    if not isinstance(expr.func, ast.Name) or expr.func.id != expected_name:
        return None
    if expr.args:
        return None

    kwargs: dict = {}
    for kw in expr.keywords:
        if kw.arg is None:
            return None
        try:
            kwargs[kw.arg] = ast.literal_eval(kw.value)
        except Exception:
            return None

    return kwargs
