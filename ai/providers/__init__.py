"""
ai/providers/__init__.py — VizBridge provider base class.

All providers must implement stream_chat() and yield event dicts:
  {"type": "delta",     "text": "..."}          — streamed text fragment
  {"type": "tool_use",  "id": "...", "name": "...", "input": {...}}  — tool call request
  {"type": "done"}                               — conversation turn complete
  {"type": "error",     "message": "..."}        — unrecoverable error
"""

from __future__ import annotations
from typing import Iterator


class BaseProvider:
    """Abstract base — all providers must implement stream_chat."""

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        """
        Yield event dicts for one conversation turn.

        Parameters
        ----------
        messages : list[dict]
            Full conversation history in generic format:
            [{"role": "user"|"assistant"|"tool", "content": ...}]
        tools : list[dict]
            Tool schemas in Anthropic format (name/description/input_schema).
            Providers convert to their own format internally.
        system : str
            System prompt string.
        """
        raise NotImplementedError
