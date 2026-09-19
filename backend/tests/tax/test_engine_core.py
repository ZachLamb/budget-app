"""Core engine math, asserted against figures computed from the published
2026 tables. Every expected value here is hand-derivable from the rate
module -- if one fails, check the rate table before the engine."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.engine import project
from app.services.tax.inputs import TaxInputs, WithholdingBuckets
from app.services.tax.rates.registry import (
    FilingStatus,
    UnsupportedFilingStatusError,
    get_rates,
)

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


def test_single_filer_179k_full_picture():
    """The spec's worked example. 179,000 - 16,100 = 162,900 taxable."""
    p = project(make_inputs(), RATES)
    assert p.agi == Decimal("179000")
    assert p.deduction_kind == "standard"
    assert p.deduction_taken == Decimal("16100")
    assert p.taxable_income == Decimal("162900")
    assert p.federal_income_tax == Decimal("31694.00")
    assert p.social_security_tax == Decimal("11098.00")
    assert p.medicare_tax == Decimal("2595.50")
    assert p.additional_medicare_tax == Decimal("0.00")
    assert p.state_tax == Decimal("7167.60")
    assert p.total_liability == Decimal("52555.10")


def test_standard_deduction_wins_when_itemized_is_lower():
    p = project(make_inputs(itemized_deductions=Decimal("5000")), RATES)
    assert p.deduction_kind == "standard"
    assert p.deduction_taken == Decimal("16100")
    assert p.itemized_total == Decimal("5000")
    assert p.standard_deduction == Decimal("16100")


def test_itemized_wins_when_higher():
    p = project(make_inputs(itemized_deductions=Decimal("20000")), RATES)
    assert p.deduction_kind == "itemized"
    assert p.deduction_taken == Decimal("20000")


def test_401k_reduces_income_tax_but_not_fica():
    """The single most important behavior in this module."""
    base = project(make_inputs(), RATES)
    deferred = project(make_inputs(pretax_401k=Decimal("23500")), RATES)

    assert deferred.social_security_tax == base.social_security_tax
    assert deferred.medicare_tax == base.medicare_tax
    assert deferred.federal_income_tax < base.federal_income_tax
    assert deferred.state_tax < base.state_tax

    saved = base.total_liability - deferred.total_liability
    assert saved == Decimal("6674.00")


def test_hsa_reduces_fica_as_well():
    base = project(make_inputs(), RATES)
    hsa = project(make_inputs(pretax_hsa=Decimal("4000")), RATES)
    assert hsa.social_security_tax < base.social_security_tax
    assert hsa.medicare_tax < base.medicare_tax


def test_social_security_caps_at_the_wage_base():
    capped = project(make_inputs(wages_ytd=Decimal("300000")), RATES)
    expected = Decimal("184500") * Decimal("0.062")
    assert capped.social_security_tax == expected.quantize(Decimal("0.01"))


def test_additional_medicare_applies_only_above_threshold():
    below = project(make_inputs(wages_ytd=Decimal("199000")), RATES)
    assert below.additional_medicare_tax == Decimal("0.00")

    above = project(make_inputs(wages_ytd=Decimal("210000")), RATES)
    assert above.additional_medicare_tax == (
        Decimal("10000") * Decimal("0.009")
    ).quantize(Decimal("0.01"))


def test_colorado_applies_to_federal_taxable_income():
    p = project(make_inputs(), RATES)
    assert p.state_tax == (
        p.taxable_income * Decimal("0.044")
    ).quantize(Decimal("0.01"))


def test_taxable_income_never_negative():
    p = project(make_inputs(wages_ytd=Decimal("10000")), RATES)
    assert p.taxable_income == Decimal("0")
    assert p.federal_income_tax == Decimal("0.00")


def test_refund_is_positive_and_amount_due_is_negative():
    owed = project(make_inputs(federal_withheld_ytd=Decimal("1000")), RATES)
    assert owed.refund_or_amount_due < 0

    refund = project(
        make_inputs(
            federal_withheld_ytd=Decimal("40000"),
            state_withheld_ytd=Decimal("8000"),
            ss_withheld_ytd=Decimal("11098"),
            medicare_withheld_ytd=Decimal("2595.50"),
        ),
        RATES,
    )
    assert refund.refund_or_amount_due > 0


def test_unsupported_filing_status_raises_rather_than_approximating():
    with pytest.raises(UnsupportedFilingStatusError):
        project(make_inputs(filing_status=FilingStatus.MARRIED_JOINT), RATES)


def test_explain_trace_is_populated_and_ordered():
    p = project(make_inputs(), RATES)
    labels = [s.label for s in p.explain]
    assert "Adjusted gross income" in labels
    assert "Taxable income" in labels
    assert labels.index("Adjusted gross income") < labels.index("Taxable income")
