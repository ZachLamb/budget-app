"""Shared helpers to parse JSON returned by local LLMs (optional markdown fences)."""

from __future__ import annotations

import json


def strip_json_markdown_fence(text: str) -> str:
    """Remove optional ```json ... ``` wrapper if present."""
    t = text.strip()
    if not t.startswith("```"):
        return t
    inner = t.split("\n", 1)[1] if "\n" in t else ""
    inner = inner.rsplit("```", 1)[0]
    return inner.strip()


def parse_llm_json_object(text: str) -> dict:
    """Parse a JSON object from model output; raises json.JSONDecodeError or ValueError."""
    raw = strip_json_markdown_fence(text)
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise ValueError("LLM JSON must be an object")
    return obj
