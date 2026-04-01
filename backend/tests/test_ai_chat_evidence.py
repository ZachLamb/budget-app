"""Tests for deterministic chat evidence payloads."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.api.routes.ai import ChatEvidenceCategorySpending, build_category_spending_evidence


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
