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
    """Phase 1 populates SINGLE only; others must not be approximated."""


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
    additional_medicare_threshold: Decimal
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


def get_rates(year: int) -> RateSet:
    from app.services.tax.rates import colorado_2026, federal_2026

    if year == 2026:
        return RateSet(
            year=2026,
            federal=federal_2026.RATES,
            state=colorado_2026.RATES,
            passive_loss=federal_2026.PASSIVE_LOSS,
            supported_statuses=federal_2026.SUPPORTED_STATUSES,
        )
    raise UnknownTaxYearError(
        f"No tax rate table for {year}. Rate tables are added deliberately, "
        f"one module per year -- see app/services/tax/rates/."
    )
