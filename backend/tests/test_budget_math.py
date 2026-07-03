"""Pure envelope-rollover math (see docs/superpowers/specs/2026-07-02-budget-rollover-design.md).

Rules under test:
- carry_in(m+1) = max(0, carry_in(m) + assigned(m) + activity(m))
- overspend clipped at a month boundary reduces Ready to Assign for months
  AFTER it — never the month it happened (the viewed month shows negative).
- RTA = cum_income(<=M) - cum_assigned(<=M) - sum(overspend(m) for m < M)
- income categories never carry; gap months pass carry through.
"""
from decimal import Decimal

from app.services.budget_math import compute_rollover

D = Decimal
GROC = "cat-groceries"
DINE = "cat-dining"
INC = "cat-salary"
INCOME_IDS = {INC}


def test_single_month_matches_legacy_behavior():
    r = compute_rollover(
        assigned={(GROC, "2026-06"): D("400")},
        activity={(GROC, "2026-06"): D("-310"), (INC, "2026-06"): D("1000")},
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    g = r.categories[GROC]
    assert (g.carryover, g.available) == (D("0"), D("90"))
    assert r.ready_to_assign == D("600")          # 1000 - 400, no history
    assert r.overspend_deducted == D("0")


def test_underspend_carries_into_next_month():
    r = compute_rollover(
        assigned={(GROC, "2026-05"): D("400"), (GROC, "2026-06"): D("400")},
        activity={(GROC, "2026-05"): D("-375"), (GROC, "2026-06"): D("-310")},
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    g = r.categories[GROC]
    assert g.carryover == D("25")
    assert g.available == D("115")                # 25 + 400 - 310
    assert r.total_carryover_in == D("25")


def test_overspend_resets_and_deducts_from_next_month_rta():
    r = compute_rollover(
        assigned={(DINE, "2026-05"): D("150"), (INC, "2026-05"): D("0")},
        activity={(DINE, "2026-05"): D("-190"), (INC, "2026-05"): D("1000")},
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    d = r.categories[DINE]
    assert d.carryover == D("0")                  # clamped, not carried negative
    assert r.overspend_deducted == D("40")
    assert r.ready_to_assign == D("810")          # 1000 - 150 - 40


def test_viewed_month_overspend_shows_negative_and_does_not_deduct_yet():
    r = compute_rollover(
        assigned={(DINE, "2026-06"): D("150")},
        activity={(DINE, "2026-06"): D("-190"), (INC, "2026-06"): D("1000")},
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    assert r.categories[DINE].available == D("-40")
    assert r.overspend_deducted == D("0")
    assert r.ready_to_assign == D("850")          # 1000 - 150; deduction comes next month


def test_gap_months_pass_carry_through():
    r = compute_rollover(
        assigned={(GROC, "2026-01"): D("100")},
        activity={},
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    assert r.categories[GROC].carryover == D("100")
    assert r.categories[GROC].available == D("100")


def test_income_categories_do_not_carry_and_fund_rta_cumulatively():
    r = compute_rollover(
        assigned={},
        activity={(INC, "2026-05"): D("1000"), (INC, "2026-06"): D("500")},
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    assert INC not in r.categories
    assert r.ready_to_assign == D("1500")


def test_reconciliation_invariant():
    """RTA + sum(available) + forgiven overspend == cum_income + cum_activity(spend)...
    concretely: money is conserved across two months with a mix of under/over spend."""
    r = compute_rollover(
        assigned={
            (GROC, "2026-05"): D("400"), (DINE, "2026-05"): D("150"),
            (GROC, "2026-06"): D("400"), (DINE, "2026-06"): D("150"),
        },
        activity={
            (GROC, "2026-05"): D("-375"), (DINE, "2026-05"): D("-190"),
            (INC, "2026-05"): D("2000"), (INC, "2026-06"): D("2000"),
            (GROC, "2026-06"): D("-100"), (DINE, "2026-06"): D("-100"),
        },
        income_category_ids=INCOME_IDS,
        viewed_month="2026-06",
    )
    # cum_income 4000 - cum_assigned 1100 - prior overspend 40 = 2860
    assert r.ready_to_assign == D("2860")
    # Groceries: carry 25 + 400 - 100 = 325; Dining: 0 + 150 - 100 = 50
    assert r.categories[GROC].available == D("325")
    assert r.categories[DINE].available == D("50")
