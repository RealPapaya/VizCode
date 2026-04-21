"""
ai/providers/gemini_provider.py — Google Gemini provider for VizBridge.

Uses urllib.request (stdlib only) to call the Gemini streamGenerateContent API.
Gemini returns a stream of newline-delimited JSON objects (not SSE), each being
a partial GenerateContentResponse.

Tool calling uses Gemini's functionDeclarations / functionCall / functionResponse
format, which differs from both Anthropic and OpenAI.

Fix (2025-04):
  - _GEMINI_TERMINAL_ERRORS now drives finishReason logic.
    Intermediate streaming chunks often return "FINISH_REASON_UNSPECIFIED"
    (or other non-fatal reasons) which the old whitelist approach mis-treated
    as errors, silently dropping all output.
  - Only genuine safety / policy stops are surfaced as errors.
"""

from __future__ import annotations

import json
import socket
import urllib.request
import urllib.error
from typing import Iterator

from ._errors import format_http_error, format_url_error

from . import BaseProvider

# ─── Constants ────────────────────────────────────────────────────────────────

_API_BASE      = "https://generativelanguage.googleapis.com/v1beta/models"
_DEFAULT_MODEL = "gemini-2.0-flash"
_MAX_TOKENS    = 4096

# Only these finishReasons represent a hard stop that should surface as an error.
# Everything else (STOP, MAX_TOKENS, FINISH_REASON_UNSPECIFIED, "", None …)
# is either a normal end or an intermediate chunk — never an error.
_GEMINI_TERMINAL_ERRORS: set[str] = {
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "MALFORMED_FUNCTION_CALL",
    "IMAGE_SAFETY",
    "OTHER",
}


# ─── GeminiProvider ───────────────────────────────────────────────────────────

class GeminiProvider(BaseProvider):

    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL):
        self._api_key = api_key
        self._model   = model or _DEFAULT_MODEL

    # ── Public ────────────────────────────────────────────────────────────────

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        contents, system_instruction = _to_gemini_messages(messages, system)
        gemini_tools = _to_gemini_tools(tools)

        url = (
            f"{_API_BASE}/{self._model}:streamGenerateContent"
            f"?key={self._api_key}&alt=sse"
        )

        body: dict = {
            "contents":         contents,
            "generationConfig": {"maxOutputTokens": _MAX_TOKENS},
        }
        if system_instruction:
            body["systemInstruction"] = {"parts": [{"text": system_instruction}]}
        if gemini_tools:
            body["tools"] = gemini_tools

        try:
            yield from self._stream(url, body)
        except urllib.error.HTTPError as e:
            yield {"type": "error", "message": format_http_error(e, "Gemini")}
        except (urllib.error.URLError, socket.timeout) as e:
            yield {"type": "error", "message": format_url_error(e, "generativelanguage.googleapis.com", "Gemini")}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    # ── Private ───────────────────────────────────────────────────────────────

    def _stream(self, url: str, body: dict) -> Iterator[dict]:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=raw, method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept":       "text/event-stream",
            },
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                # Gemini SSE: events separated by \n\n
                while b"\n\n" in buf:
                    raw_event, buf = buf.split(b"\n\n", 1)
                    data_str = ""
                    for line in raw_event.decode("utf-8").splitlines():
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                    try:
                        resp_obj = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    yield from self._handle_response(resp_obj)

        yield {"type": "done"}

    def _handle_response(self, resp_obj: dict) -> Iterator[dict]:
        """Parse one GenerateContentResponse chunk."""
        # Prompt-level blocking (happens before any candidate)
        if "promptFeedback" in resp_obj:
            block = resp_obj["promptFeedback"].get("blockReason")
            if block:
                yield {"type": "error", "message": f"Gemini blocked the prompt: {block}"}
                return

        for candidate in resp_obj.get("candidates", []):
            finish = candidate.get("finishReason") or ""

            # --- KEY FIX ---
            # Only raise an error for known terminal policy/safety stops.
            # "FINISH_REASON_UNSPECIFIED", "", None, "STOP", "MAX_TOKENS"
            # are all benign and must NOT abort the stream.
            if finish in _GEMINI_TERMINAL_ERRORS:
                yield {
                    "type":    "error",
                    "message": f"Gemini stopped generating: {finish}",
                }
                return

            content = candidate.get("content", {})
            for part in content.get("parts", []):
                # Text part
                text = part.get("text")
                if text:
                    yield {"type": "delta", "text": text}

                # Function call part
                fn_call = part.get("functionCall")
                if fn_call:
                    args = fn_call.get("args", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    yield {
                        "type":  "tool_use",
                        "id":    fn_call.get("name", ""),   # Gemini has no separate call ID
                        "name":  fn_call.get("name", ""),
                        "input": args,
                    }


# ─── Format converters ────────────────────────────────────────────────────────

def _to_gemini_messages(
    messages: list[dict], system: str
) -> tuple[list[dict], str]:
    """
    Convert VizBridge generic messages to Gemini `contents` list.
    Returns (contents, system_instruction_text).

    Gemini roles: "user" | "model"
    Tool calls:   parts with functionCall
    Tool results: parts with functionResponse
    """
    contents: list[dict] = []

    for msg in messages:
        role = msg["role"]

        if role == "user":
            contents.append({
                "role":  "user",
                "parts": [{"text": str(msg["content"])}],
            })

        elif role == "assistant":
            content = msg.get("content", [])
            parts: list[dict] = []
            if isinstance(content, str):
                parts = [{"text": content}]
            else:
                for c in content:
                    if c.get("type") == "text":
                        parts.append({"text": c["text"]})
                    elif c.get("type") == "tool_use":
                        parts.append({
                            "functionCall": {
                                "name": c["name"],
                                "args": c.get("input", {}),
                            }
                        })
            if parts:
                contents.append({"role": "model", "parts": parts})

        elif role == "tool":
            result_part = {
                "functionResponse": {
                    "name":     msg.get("tool_use_id", ""),
                    "response": {"result": str(msg["content"])},
                }
            }
            # Merge into preceding user message if possible
            if contents and contents[-1]["role"] == "user":
                contents[-1]["parts"].append(result_part)
            else:
                contents.append({"role": "user", "parts": [result_part]})

    return contents, system


def _to_gemini_tools(tools: list[dict]) -> list[dict]:
    """Convert VizBridge tool schemas to Gemini functionDeclarations format."""
    if not tools:
        return []
    decls = []
    for t in tools:
        schema = dict(t.get("inputSchema", {"type": "object", "properties": {}}))
        decls.append({
            "name":        t["name"],
            "description": t.get("description", ""),
            "parameters":  schema,
        })
    return [{"functionDeclarations": decls}]
