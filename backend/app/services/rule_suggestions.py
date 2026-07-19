"""Deterministic rule-suggestion engine.

Proposes payee→category auto-categorization rules from a household's existing
categorization history: when a payee is consistently filed under one category
but no rule covers it yet, that's a rule waiting to be created.

This is pure, side-effect-free logic so it can be unit-tested without a database.
The API route feeds it aggregated counts + existing rules; an optional on-device
LLM pass may later refine the human-readable match value, but the suggestions
here stand on their own with no model involved.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class PayeeCategoryStat:
    """One (payee, category) bucket with how many categorized txns fall in it."""

    payee_name: str
    category_id: str
    count: int


@dataclass(frozen=True)
class ExistingRuleView:
    """The parts of an existing rule needed to decide if a payee is already covered."""

    match_field: str
    match_type: str
    match_value: str
    enabled: bool


@dataclass(frozen=True)
class RuleSuggestion:
    match_field: str  # always "payee" in this engine
    match_type: str  # always "contains"
    match_value: str  # the payee name to match on
    category_id: str
    support: int  # txns in the dominant category
    total: int  # total categorized txns for the payee
    dominance: float  # support / total, in [0, 1]


def _payee_already_ruled(payee_name: str, rules: list[ExistingRuleView]) -> bool:
    """True if any enabled payee rule already matches this payee.

    We only suggest when there is no covering rule at all — this keeps the
    engine from fighting rules the user already set (including overrides), which
    is a separate, noisier problem left for a later pass.
    """
    lowered = payee_name.casefold()
    for r in rules:
        if not r.enabled or r.match_field != "payee":
            continue
        value = r.match_value.casefold()
        if r.match_type == "exact" and value == lowered:
            return True
        if r.match_type == "contains" and value and value in lowered:
            return True
    return False


def build_rule_suggestions(
    stats: list[PayeeCategoryStat],
    existing_rules: list[ExistingRuleView],
    *,
    min_support: int = 3,
    min_dominance: float = 0.8,
    limit: int = 10,
) -> list[RuleSuggestion]:
    """Propose payee→category rules from categorization history.

    A payee is suggested when, across its categorized transactions, one category
    accounts for at least ``min_dominance`` of them, that category has at least
    ``min_support`` transactions, and no enabled payee rule already matches it.

    Results are sorted by support (then dominance) descending and capped at
    ``limit``. Deterministic: same input always yields the same output.
    """
    by_payee: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for s in stats:
        if not s.payee_name or not s.category_id or s.count <= 0:
            continue
        by_payee[s.payee_name][s.category_id] += s.count

    suggestions: list[RuleSuggestion] = []
    for payee_name, cat_counts in by_payee.items():
        total = sum(cat_counts.values())
        if total < min_support:
            continue
        category_id, support = max(cat_counts.items(), key=lambda kv: (kv[1], kv[0]))
        if support < min_support:
            continue
        dominance = support / total
        if dominance < min_dominance:
            continue
        if _payee_already_ruled(payee_name, existing_rules):
            continue
        suggestions.append(
            RuleSuggestion(
                match_field="payee",
                match_type="contains",
                match_value=payee_name,
                category_id=category_id,
                support=support,
                total=total,
                dominance=dominance,
            )
        )

    suggestions.sort(key=lambda s: (s.support, s.dominance, s.match_value), reverse=True)
    return suggestions[:limit]
