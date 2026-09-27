"""The rate registry must fail loudly on an unknown year rather than
silently reusing another year's brackets."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.rates.registry import (
    FilingStatus,
    UnknownTaxYearError,
    get_rates,
)


def test_2026_single_figures_match_published_values():
    rates = get_rates(2026)
    fed = rates.federal
    assert fed.standard_deduction[FilingStatus.SINGLE] == Decimal("16100")
    assert fed.social_security_wage_base == Decimal("184500")
    assert fed.social_security_rate == Decimal("0.062")
    assert fed.medicare_rate == Decimal("0.0145")
    assert fed.additional_medicare_threshold[FilingStatus.SINGLE] == Decimal("200000")
    # The surtax starts $50,000 higher jointly and $75,000 lower filing
    # separately. One figure for all three was wrong for two of them.
    assert fed.additional_medicare_threshold[FilingStatus.MARRIED_JOINT] == Decimal("250000")
    assert fed.additional_medicare_threshold[FilingStatus.MARRIED_SEPARATE] == Decimal("125000")
    assert fed.additional_medicare_rate == Decimal("0.009")

    brackets = fed.brackets[FilingStatus.SINGLE]
    assert [b.upper for b in brackets[:3]] == [
        Decimal("12400"), Decimal("50400"), Decimal("105700")
    ]
    assert [b.rate for b in brackets[:3]] == [
        Decimal("0.10"), Decimal("0.12"), Decimal("0.22")
    ]
    assert brackets[-1].upper is None
    assert brackets[-1].rate == Decimal("0.37")


def test_brackets_are_contiguous_and_ascending():
    """A typo in a bracket edge is silent and expensive; assert structure."""
    brackets = get_rates(2026).federal.brackets[FilingStatus.SINGLE]
    uppers = [b.upper for b in brackets]
    assert uppers[-1] is None, "last bracket must be open-ended"
    finite = uppers[:-1]
    assert finite == sorted(finite), "bracket edges must ascend"
    assert len(set(finite)) == len(finite), "bracket edges must be unique"
    rates = [b.rate for b in brackets]
    assert rates == sorted(rates), "marginal rates must not decrease"


def test_colorado_is_flat_on_federal_taxable_income():
    state = get_rates(2026).state
    assert state.code == "CO"
    assert state.flat_rate == Decimal("0.044")
    assert state.starts_from_federal_taxable_income is True


def test_unknown_year_raises_rather_than_falling_back():
    with pytest.raises(UnknownTaxYearError) as exc:
        get_rates(2019)
    assert "2019" in str(exc.value)


def test_passive_loss_allowance_constants():
    pal = get_rates(2026).passive_loss
    assert pal.max_allowance == Decimal("25000")
    assert pal.phaseout_start == Decimal("100000")
    assert pal.phaseout_end == Decimal("150000")


def test_2026_brackets_reproduce_the_revenue_procedure_worked_figures():
    """Rev. Proc. 2025-32 prints the tax at each bracket floor.

    Those printed amounts are an independent check on the thresholds: get a
    threshold wrong and the cumulative tax at the next floor stops matching.
    """
    from decimal import Decimal
    from app.services.tax.rates.registry import FilingStatus, get_rates

    fed = get_rates(2026).federal

    def tax_at(status: FilingStatus, taxable: Decimal) -> Decimal:
        total, floor = Decimal("0"), Decimal("0")
        for bracket in fed.brackets[status]:
            ceiling = bracket.upper if bracket.upper is not None else taxable
            if taxable <= floor:
                break
            slice_top = min(taxable, ceiling)
            total += (slice_top - floor) * bracket.rate
            floor = ceiling
        return total

    # "The Tax Is" column, table by table, at each bracket floor.
    cases = [
        (FilingStatus.MARRIED_JOINT, "100800", "11600"),
        (FilingStatus.MARRIED_JOINT, "211400", "35932"),
        (FilingStatus.MARRIED_JOINT, "768700", "206583.50"),
        (FilingStatus.SINGLE, "105700", "17966"),
        (FilingStatus.SINGLE, "640600", "192979.25"),
        (FilingStatus.HEAD_OF_HOUSEHOLD, "67450", "7740"),
        (FilingStatus.HEAD_OF_HOUSEHOLD, "105700", "16155"),
        (FilingStatus.HEAD_OF_HOUSEHOLD, "201750", "39207"),
        (FilingStatus.MARRIED_SEPARATE, "256225", "58448"),
        (FilingStatus.MARRIED_SEPARATE, "384350", "103291.75"),
    ]
    for status, taxable, expected in cases:
        got = tax_at(status, Decimal(taxable))
        assert abs(got - Decimal(expected)) < Decimal("0.51"), (
            f"{status.value} at {taxable}: engine {got}, Rev. Proc. {expected}"
        )


def test_surviving_spouse_uses_the_joint_table_not_an_approximation_of_it():
    """Table 1 is headed "Married Individuals Filing Joint Returns AND
    Surviving Spouses" — the same table, not a near-enough one."""
    from app.services.tax.rates.registry import FilingStatus, get_rates

    fed = get_rates(2026).federal
    assert (
        fed.brackets[FilingStatus.QUALIFYING_SURVIVING_SPOUSE]
        == fed.brackets[FilingStatus.MARRIED_JOINT]
    )
    assert (
        fed.standard_deduction[FilingStatus.QUALIFYING_SURVIVING_SPOUSE]
        == fed.standard_deduction[FilingStatus.MARRIED_JOINT]
    )
