"""Deterministic rule-suggestion engine (app/services/rule_suggestions.py).

A payee is suggested when one category dominates its categorized history
(>= min_dominance, >= min_support) and no enabled payee rule already covers it.
"""
from app.services.rule_suggestions import (
    ExistingRuleView,
    PayeeCategoryStat,
    RuleSuggestion,
    build_rule_suggestions,
)


def _stat(payee, cat, count):
    return PayeeCategoryStat(payee_name=payee, category_id=cat, count=count)


def test_suggests_dominant_payee_with_no_rule():
    stats = [_stat("Starbucks", "coffee", 5)]
    out = build_rule_suggestions(stats, [], min_support=3, min_dominance=0.8)
    assert len(out) == 1
    s = out[0]
    assert isinstance(s, RuleSuggestion)
    assert s.match_field == "payee"
    assert s.match_type == "contains"
    assert s.match_value == "Starbucks"
    assert s.category_id == "coffee"
    assert s.support == 5
    assert s.total == 5
    assert s.dominance == 1.0


def test_skips_payee_below_support_threshold():
    stats = [_stat("Rare Store", "misc", 2)]
    assert build_rule_suggestions(stats, [], min_support=3) == []


def test_skips_payee_below_dominance_threshold():
    # 3 coffee + 3 groceries → dominant category is only 50%.
    stats = [_stat("Costco", "coffee", 3), _stat("Costco", "groceries", 3)]
    assert build_rule_suggestions(stats, [], min_support=3, min_dominance=0.8) == []


def test_dominant_category_wins_when_above_threshold():
    # 9 groceries + 1 coffee → 90% dominance for groceries.
    stats = [_stat("Kroger", "groceries", 9), _stat("Kroger", "coffee", 1)]
    out = build_rule_suggestions(stats, [], min_dominance=0.8)
    assert len(out) == 1
    assert out[0].category_id == "groceries"
    assert out[0].support == 9
    assert out[0].total == 10


def test_skips_payee_already_covered_by_exact_rule():
    stats = [_stat("Netflix", "streaming", 6)]
    rules = [ExistingRuleView("payee", "exact", "Netflix", enabled=True)]
    assert build_rule_suggestions(stats, rules) == []


def test_skips_payee_already_covered_by_contains_rule():
    stats = [_stat("Shell Gas #123", "gas", 4)]
    rules = [ExistingRuleView("payee", "contains", "Shell", enabled=True)]
    assert build_rule_suggestions(stats, rules) == []


def test_disabled_rule_does_not_count_as_coverage():
    stats = [_stat("Netflix", "streaming", 6)]
    rules = [ExistingRuleView("payee", "exact", "Netflix", enabled=False)]
    out = build_rule_suggestions(stats, rules)
    assert len(out) == 1
    assert out[0].match_value == "Netflix"


def test_non_payee_rule_does_not_cover():
    stats = [_stat("Netflix", "streaming", 6)]
    rules = [ExistingRuleView("notes", "contains", "netflix", enabled=True)]
    assert len(build_rule_suggestions(stats, rules)) == 1


def test_results_sorted_by_support_desc_and_limited():
    stats = [
        _stat("A", "c", 3),
        _stat("B", "c", 8),
        _stat("C", "c", 5),
    ]
    out = build_rule_suggestions(stats, [], limit=2)
    assert [s.match_value for s in out] == ["B", "C"]


def test_ignores_empty_and_nonpositive_rows():
    stats = [
        _stat("", "c", 5),
        _stat("Ghost", "", 5),
        _stat("Neg", "c", -4),
        _stat("Good", "c", 4),
    ]
    out = build_rule_suggestions(stats, [])
    assert [s.match_value for s in out] == ["Good"]
