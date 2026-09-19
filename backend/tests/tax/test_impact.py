"""impact_of must be exact for the amount asked about, and additive."""
from __future__ import annotations

from decimal import Decimal

from app.services.tax.engine import impact_of, project
from app.services.tax.inputs import (
    ExtraBusinessExpense,
    ExtraItemizedDeduction,
    ExtraPretax401k,
    ExtraWages,
    ScheduleEResult,
    TaxInputs,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import FilingStatus, get_rates

RATES = get_rates(2026)


def make_inputs(**overrides) -> TaxInputs:
    base = dict(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=Decimal("179000"),
        projected_remaining_wages=Decimal("0"),
        pretax_401k=Decimal("0"),
        pretax_hsa=Decimal("0"),
        pretax_other=Decimal("0"),
        federal_withheld_ytd=Decimal("0"),
        state_withheld_ytd=Decimal("0"),
        ss_withheld_ytd=Decimal("0"),
        medicare_withheld_ytd=Decimal("0"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=Decimal("0"),
        schedule_e=None,
        prior_year_total_tax=None,
        prior_year_agi=None,
    )
    base.update(overrides)
    return TaxInputs(**base)


def test_extra_wages_cost_the_expected_dollars():
    """At $179k: 24% federal + 6.2% SS + 1.45% Medicare + 4.4% CO."""
    cost = impact_of(make_inputs(), ExtraWages(Decimal("1000")), RATES)
    assert cost == Decimal("360.50")


def test_401k_saves_less_than_the_marginal_rate_because_fica_is_untouched():
    saved = -impact_of(make_inputs(), ExtraPretax401k(Decimal("23500")), RATES)
    assert saved == Decimal("6674.00")
    naive = Decimal("23500") * Decimal("0.3605")
    assert saved < naive


def test_impact_is_additive():
    """Required for a coherent phase 3 ranking."""
    inputs = make_inputs(wages_ytd=Decimal("120000"))
    first = impact_of(inputs, ExtraWages(Decimal("5000")), RATES)
    after_first = ExtraWages(Decimal("5000")).apply(inputs)
    second = impact_of(after_first, ExtraWages(Decimal("5000")), RATES)
    both = impact_of(inputs, ExtraWages(Decimal("10000")), RATES)
    assert first + second == both


def test_impact_does_not_mutate_the_caller_inputs():
    inputs = make_inputs()
    before = project(inputs, RATES).total_liability
    impact_of(inputs, ExtraWages(Decimal("50000")), RATES)
    assert project(inputs, RATES).total_liability == before


def test_personal_itemized_deduction_below_standard_is_worth_nothing():
    """The headline correctness fix. Not an approximation -- exactly zero."""
    saved = -impact_of(
        make_inputs(), ExtraItemizedDeduction(Decimal("5000")), RATES
    )
    assert saved == Decimal("0.00")


def test_business_expense_is_worth_something_from_the_first_dollar():
    """Same dollars as the test above, valued through Schedule E."""
    inputs = make_inputs(
        schedule_e=ScheduleEResult(
            gross_rental_income=Decimal("30000"),
            allowable_expenses=Decimal("10000"),
            net=Decimal("20000"),
            active_participation=True,
            suspended_loss_carryin=Decimal("0"),
        )
    )
    saved = -impact_of(inputs, ExtraBusinessExpense(Decimal("5000")), RATES)
    assert saved > Decimal("0")
    assert saved == Decimal("1420.00")   # 5,000 x (24% + 4.4%) -- no FICA on rental


def test_business_expense_beyond_rental_income_is_worth_nothing_at_high_income():
    """At $179k MAGI the passive-loss allowance is zero, so an expense that
    creates a LOSS suspends rather than reducing this year's tax."""
    inputs = make_inputs(
        schedule_e=ScheduleEResult(
            gross_rental_income=Decimal("10000"),
            allowable_expenses=Decimal("10000"),
            net=Decimal("0"),
            active_participation=True,
            suspended_loss_carryin=Decimal("0"),
        )
    )
    saved = -impact_of(inputs, ExtraBusinessExpense(Decimal("5000")), RATES)
    assert saved == Decimal("0.00")


def test_perturbation_surfaces_the_passive_loss_phaseout_cliff():
    """Inside the $100k-$150k phase-out an extra dollar of wages also
    destroys 50c of rental-loss allowance. Nothing special-cases this."""
    def cost_at(wages: str) -> Decimal:
        inputs = make_inputs(
            wages_ytd=Decimal(wages),
            schedule_e=ScheduleEResult(
                gross_rental_income=Decimal("30000"),
                allowable_expenses=Decimal("48000"),
                net=Decimal("-18000"),
                active_participation=True,
                suspended_loss_carryin=Decimal("0"),
            ),
        )
        return impact_of(inputs, ExtraWages(Decimal("1000")), RATES)

    inside = cost_at("125000")
    outside = cost_at("155000")
    assert inside > outside, "the phase-out must cost more than the bracket alone"
    assert inside > Decimal("400"), "should exceed a plain 34% marginal cost"
