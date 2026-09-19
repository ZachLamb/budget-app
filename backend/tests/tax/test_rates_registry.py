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
    assert fed.additional_medicare_threshold == Decimal("200000")
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
