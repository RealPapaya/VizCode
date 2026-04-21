"""
ai/providers/custom_provider.py — Generic OpenAI-compatible provider for VizBridge.

Accepts any service that exposes an OpenAI-style /chat/completions endpoint:
OpenRouter, Groq, Together AI, LM Studio, local proxies, etc.

Set custom_base_url to the provider's base URL, e.g.:
    https://openrouter.ai/api/v1
    https://api.groq.com/openai/v1
    http://localhost:1234/v1

'/chat/completions' is appended automatically if not already present.
Authentication uses a standard Bearer token (custom_api_key).
"""

from __future__ import annotations

from typing import Iterator

from . import BaseProvider

_COMPLETIONS_PATH = "/chat/completions"
_DEFAULT_MODEL    = ""


class CustomProvider(BaseProvider):

    def __init__(self, api_key: str, base_url: str, model: str = _DEFAULT_MODEL):
        b = (base_url or "").rstrip("/")
        if not b:
            raise ValueError(
                "custom_base_url is required for the Custom provider. "
                "Enter a base URL such as https://openrouter.ai/api/v1."
            )
        if not model:
            raise ValueError(
                "Model name is required for the Custom provider. "
                "Enter the model ID (e.g. llama-3.3-70b-versatile for Groq, "
                "or meta-llama/llama-3.1-8b-instruct:free for OpenRouter)."
            )
        self._endpoint = b if b.endswith("/chat/completions") else b + _COMPLETIONS_PATH
        from .openai_provider import OpenAIProvider
        self._impl = OpenAIProvider(
            api_key=api_key,
            model=model,
            base_url=self._endpoint,
        )

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
    ) -> Iterator[dict]:
        yield from self._impl.stream_chat(messages, tools, system)
