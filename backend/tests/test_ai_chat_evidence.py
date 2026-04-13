"""Tests for deterministic chat evidence payloads."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.api.routes.ai import (
    ChatEvidenceCategorySpending,
    build_budget_pace_evidence_rows,
    build_category_spending_evidence,
    build_goal_progress_evidence_rows,
)


def test_build_category_spending_evidence_one_line() -> None:
    out = build_category_spending_evidence("2026-04", [("Groceries", Decimal("-120.50"))])
    assert len(out) == 1
    parsed = ChatEvidenceCategorySpending.model_validate(out[0])
    assert parsed.type == "category_spending"
    assert parsed.month == "2026-04"
    assert parsed.lines[0].category == "Groceries"
    assert parsed.lines[0].amount == pytest.approx(120.50)


def test_build_category_spending_evidence_empty_rows() -> None:
    out = build_category_spending_evidence("2026-04", [])
    parsed = ChatEvidenceCategorySpending.model_validate(out[0])
    assert parsed.lines == []


def test_build_goal_progress_evidence_rows() -> None:
    d = build_goal_progress_evidence_rows(
        [("Vacation", "savings", Decimal("400"), Decimal("1000"))],
    )
    assert d is not None
    assert d["type"] == "goal_progress"
    assert d["goals"][0]["name"] == "Vacation"
    assert d["goals"][0]["pct_complete"] == pytest.approx(40.0)


def test_build_goal_progress_empty_returns_none() -> None:
    assert build_goal_progress_evidence_rows([]) is None


def test_build_budget_pace_evidence_rows() -> None:
    d = build_budget_pace_evidence_rows("2026-04", [("Food", 300.0, 350.0)])
    assert d is not None
    assert d["type"] == "budget_pace"
    assert d["lines"][0]["remaining"] == pytest.approx(-50.0)
