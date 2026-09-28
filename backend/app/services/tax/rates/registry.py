"""Versioned tax rate tables, one module per jurisdiction per year.

Rates are DATA, reviewed once a year. Every figure carries its source URL
in the module that defines it. get_rates() raises on a year it has no
table for rather than falling back to an adjacent year -- a stale-rate
bug is invisible in the UI and wrong by thousands of dollars.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class FilingStatus(StrEnum):
    SINGLE = "single"
    MARRIED_JOINT = "married_joint"
    MARRIED_SEPARATE = "married_separate"
    HEAD_OF_HOUSEHOLD = "head_of_household"
    QUALIFYING_SURVIVING_SPOUSE = "qualifying_surviving_spouse"


class UnknownTaxYearError(LookupError):
    """No rate table exists for the requested year."""


class UnsupportedFilingStatusError(NotImplementedError):
    """A filing status with no sourced brackets must not be approximated."""


class UnsupportedStateError(NotImplementedError):
    """No sourced rate table for this state.

    Distinct from a state that taxes nothing: those have a real table with
    a zero rate. This means "we do not know", and the caller must say so
    rather than return a figure.
    """


@dataclass(frozen=True)
class Bracket:
    upper: Decimal | None   # None = open-ended top bracket
    rate: Decimal


@dataclass(frozen=True)
class FederalRates:
    brackets: dict[FilingStatus, list[Bracket]]
    standard_deduction: dict[FilingStatus, Decimal]
    social_security_wage_base: Decimal
    social_security_rate: Decimal
    medicare_rate: Decimal
    # Per status: the 0.9% surtax starts at $250,000 jointly, $125,000
    # filing separately and $200,000 otherwise. A single figure here
    # overstated a couple's tax by up to $450 and understated a separate
    # filer's, silently, because the arithmetic still looked ordinary.
    additional_medicare_threshold: dict[FilingStatus, Decimal]
    additional_medicare_rate: Decimal


@dataclass(frozen=True)
class StateRates:
    code: str
    flat_rate: Decimal
    starts_from_federal_taxable_income: bool


@dataclass(frozen=True)
class PassiveLossRates:
    max_allowance: Decimal
    phaseout_start: Decimal
    phaseout_end: Decimal


@dataclass(frozen=True)
class RateSet:
    year: int
    federal: FederalRates
    state: StateRates
    passive_loss: PassiveLossRates
    supported_statuses: frozenset[FilingStatus]


def supported_statuses(year: int) -> frozenset[FilingStatus]:
    """Filing statuses with sourced brackets for this year.

    Separate from `get_rates` because the walkthrough wants this list even
    when the state is unknown, and a state is not needed to answer it.
    """
    from app.services.tax.rates import federal_2026

    if year != 2026:
        raise UnknownTaxYearError(
            f"No tax rate table for {year}. Rate tables are added "
            f"deliberately, one module per year -- see app/services/tax/rates/."
        )
    return federal_2026.SUPPORTED_STATUSES


def supported_states(year: int) -> frozenset[str]:
    """State codes with a sourced table for this year."""
    from app.services.tax.rates import colorado_2026, no_income_tax_states_2026

    if year != 2026:
        raise UnknownTaxYearError(
            f"No tax rate table for {year}. Rate tables are added "
            f"deliberately, one module per year -- see app/services/tax/rates/."
        )
    return frozenset({colorado_2026.RATES.code, *no_income_tax_states_2026.CODES})


def get_state_rates(year: int, state_code: str) -> StateRates:
    """Rates for one state, or a refusal.

    Every state used to resolve to Colorado, because `get_rates` hardcoded
    it. A filer in Texas was quietly charged 4.4% of their taxable income
    in a state that has no income tax at all, and nothing on the page
    suggested the figure was made up.
    """
    from app.services.tax.rates import colorado_2026, no_income_tax_states_2026

    if year != 2026:
        raise UnknownTaxYearError(
            f"No tax rate table for {year}. Rate tables are added "
            f"deliberately, one module per year -- see app/services/tax/rates/."
        )

    code = (state_code or "").strip().upper()
    if code == colorado_2026.RATES.code:
        return colorado_2026.RATES
    if code in no_income_tax_states_2026.RATES:
        return no_income_tax_states_2026.RATES[code]
    raise UnsupportedStateError(
        f"No {year} rate table for {code or 'an unset state'}. Add its "
        f"sourced module rather than approximating from another state."
    )


def get_rates(year: int, state_code: str) -> RateSet:
    from app.services.tax.rates import federal_2026

    if year == 2026:
        return RateSet(
            year=2026,
            federal=federal_2026.RATES,
            state=get_state_rates(year, state_code),
            passive_loss=federal_2026.PASSIVE_LOSS,
            supported_statuses=federal_2026.SUPPORTED_STATUSES,
        )
    raise UnknownTaxYearError(
        f"No tax rate table for {year}. Rate tables are added deliberately, "
        f"one module per year -- see app/services/tax/rates/."
    )
