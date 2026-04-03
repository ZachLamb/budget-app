"""Unit tests for AI route LLM JSON parsing helpers (test-first guardrails)."""
from __future__ import annotations

from app.api.routes.ai import (
    DebtPlanSuggestion,
    MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA,
    normalize_insights_list,
    normalize_priority_order_from_llm,
    parse_debt_plan_suggestion_from_llm_response,
)


def test_normalize_priority_order_list_coerces_elements() -> None:
    assert normalize_priority_order_from_llm(["a", 1, None]) == ["a", "1", "None"]


def test_normalize_priority_order_non_list_returns_empty() -> None:
    assert normalize_priority_order_from_llm("Visa, MC") == []
    assert normalize_priority_order_from_llm(None) == []


def test_parse_debt_plan_strips_markdown_fence() -> None:
    text = """```json
{"strategy": "snowball", "rationale": "x", "priority_order": ["A", "B"], "monthly_extra": 25.5}
```"""
    out = parse_debt_plan_suggestion_from_llm_response(text, "ollama")
    assert isinstance(out, DebtPlanSuggestion)
    assert out.strategy == "snowball"
    assert out.rationale == "x"
    assert out.priority_order == ["A", "B"]
    assert out.monthly_extra == 25.5
    assert out.model_source == "ollama"


def test_parse_debt_plan_string_priority_order_does_not_split_chars() -> None:
    raw = '{"strategy": "avalanche", "rationale": "r", "priority_order": "One big string", "monthly_extra": 0}'
    out = parse_debt_plan_suggestion_from_llm_response(raw, "ollama")
    assert out.priority_order == []


def test_normalize_insights_list_coerces_items() -> None:
    assert normalize_insights_list(["ok", 42]) == ["ok", "42"]


def test_normalize_insights_list_non_list_wraps() -> None:
    assert normalize_insights_list("only") == ["only"]


def test_budget_no_category_model_source_constant() -> None:
    assert MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA == "no_data"
