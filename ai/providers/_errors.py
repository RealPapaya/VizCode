"""
ai/providers/_errors.py — Shared error-formatting helpers for all providers.
Stdlib only.
"""
from __future__ import annotations

import json
import socket
import urllib.error

# ── finish_reason / stop_reason blacklists ────────────────────────────────────

OPENAI_BAD_FINISH  = {"content_filter"}   # OpenAI / Grok / Custom
ANTHROPIC_BAD_STOP: frozenset[str] = frozenset()  # placeholder — Anthropic uses error events

# ── HTTP status hints ─────────────────────────────────────────────────────────

_STATUS_HINTS: dict[int, str] = {
    401: "Check your API key (invalid, expired, or wrong format).",
    403: "Forbidden: key may lack model access, or account/IP restriction.",
    404: "Model name or endpoint URL not found.",
    429: "Rate limited - wait a moment and retry.",
    500: "Provider internal error - try again later.",
    502: "Provider gateway error - try again later.",
    503: "Provider temporarily unavailable - try again later.",
}

_PROVIDER_403_EXTRA: dict[str, str] = {
    "Grok":   " xAI sometimes blocks certain regions; try a different network.",
    "OpenAI": " Key may not have access to the requested model.",
    "Custom": " Key may not have access to this model or endpoint.",
}


def hint_for_status(code: int, provider: str) -> str:
    hint = _STATUS_HINTS.get(code, "")
    if code == 403:
        hint += _PROVIDER_403_EXTRA.get(provider, "")
    return hint


def format_http_error(exc: urllib.error.HTTPError, provider: str) -> str:
    """Read error body, extract message, return formatted string with hint."""
    err_body = ""
    try:
        err_body = exc.read().decode("utf-8", errors="replace")
        err_json = json.loads(err_body)
        error_obj = err_json.get("error") or {}
        if isinstance(error_obj, dict):
            msg = error_obj.get("message") or err_body
        elif isinstance(error_obj, str):
            msg = error_obj
        else:
            msg = err_body or f"HTTP {exc.code}"
    except Exception:
        msg = err_body or str(exc)

    hint = hint_for_status(exc.code, provider)
    suffix = f" Hint: {hint}" if hint else ""
    return f"{provider} API error {exc.code}: {msg}{suffix}"


def format_url_error(exc: Exception, host: str, provider: str) -> str:
    """Classify URLError / socket.timeout into a user-readable message."""
    if isinstance(exc, socket.timeout):
        return (
            f"Request to {provider} ({host}) timed out — "
            "provider may be slow or unreachable."
        )
    reason = getattr(exc, "reason", None)
    if isinstance(reason, socket.timeout):
        return (
            f"Request to {provider} ({host}) timed out — "
            "provider may be slow or unreachable."
        )
    if isinstance(reason, ConnectionRefusedError):
        return f"Connection refused at {host}. Is the service running?"
    return f"Cannot reach {provider} at {host}: {reason or exc}"
