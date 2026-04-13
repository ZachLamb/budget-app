"""Tests for LLM JSON fence stripping."""

from __future__ import annotations

import json

import pytest

from app.services.ai.json_extract import parse_llm_json_object, strip_json_markdown_fence


def test_strip_fence_json() -> None:
    raw = '```json\n{"a": 1}\n```'
    assert strip_json_markdown_fence(raw) == '{"a": 1}'


def test_strip_fence_plain() -> None:
    assert strip_json_markdown_fence('{"x": true}') == '{"x": true}'


def test_parse_llm_json_object_roundtrip() -> None:
    assert parse_llm_json_object('{"k": "v"}') == {"k": "v"}


def test_parse_llm_json_object_rejects_array() -> None:
    with pytest.raises(ValueError, match="object"):
        parse_llm_json_object("[1, 2]")


def test_parse_llm_json_object_invalid_json() -> None:
    with pytest.raises(json.JSONDecodeError):
        parse_llm_json_object("not json")
