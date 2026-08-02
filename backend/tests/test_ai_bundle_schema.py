"""Schema-level tests for the AI bundle export/import contract.

The apply path itself needs a database (covered by API tests); these cover the
validation boundary, which is what stands between an untrusted model-generated
file and the database.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.api.routes.ai_bundle import (
    SUGGESTIONS_KIND,
    BudgetSuggestion,
    CategorizationSuggestion,
    RuleSuggestion,
    SuggestionsBundle,
)


def test_minimal_bundle_parses_without_attribution() -> None:
    """A tool that doesn't score its output still produces a valid file."""
    bundle = SuggestionsBundle(
        kind=SUGGESTIONS_KIND,
        categorizations=[{"transaction_id": "t1", "category_id": "c1"}],
    )
    assert bundle.categorizations[0].confidence is None
    assert bundle.categorizations[0].source is None


def test_attribution_round_trips() -> None:
    s = CategorizationSuggestion(
        transaction_id="t1",
        category_id="c1",
        confidence=0.92,
        reason="Recurring coffee purchase",
        source="nano",
    )
    assert s.confidence == 0.92
    assert s.source == "nano"


@pytest.mark.parametrize("bad", [-0.1, 1.1])
def test_confidence_must_be_a_probability(bad: float) -> None:
    with pytest.raises(ValidationError):
        CategorizationSuggestion(
            transaction_id="t1", category_id="c1", confidence=bad
        )


def test_rule_match_field_is_constrained() -> None:
    """Free-text match_field would reach the rules engine — reject it."""
    with pytest.raises(ValidationError):
        RuleSuggestion(
            match_field="'; DROP TABLE transactions;--",
            match_type="contains",
            match_value="x",
            category_id="c1",
        )


def test_budget_month_format_is_enforced() -> None:
    with pytest.raises(ValidationError):
        BudgetSuggestion(category_id="c1", month="August", assigned_amount=10)


def test_negative_budget_is_rejected() -> None:
    with pytest.raises(ValidationError):
        BudgetSuggestion(category_id="c1", month="2026-08", assigned_amount=-5)


def test_oversized_ids_are_rejected() -> None:
    """Caps bound what a malformed or hostile file can push into the DB."""
    with pytest.raises(ValidationError):
        CategorizationSuggestion(transaction_id="t" * 100, category_id="c1")


def test_suggestion_count_is_capped() -> None:
    with pytest.raises(ValidationError):
        SuggestionsBundle(
            kind=SUGGESTIONS_KIND,
            categorizations=[
                {"transaction_id": f"t{i}", "category_id": "c1"} for i in range(2001)
            ],
        )
