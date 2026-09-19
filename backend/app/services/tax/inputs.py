"""Engine input and output types.

All money is Decimal. All inputs are frozen -- impact_of() perturbs by
dataclasses.replace(), never by mutation, so a caller's inputs can never
be corrupted by asking a hypothetical question about them.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Literal

from app.services.tax.rates.registry import FilingStatus

ZERO = Decimal("0")


@dataclass(frozen=True)
class WithholdingBuckets:
    federal: Decimal
    state: Decimal
    social_security: Decimal
    medicare: Decimal

    @classmethod
    def zero(cls) -> "WithholdingBuckets":
        return cls(federal=ZERO, state=ZERO, social_security=ZERO, medicare=ZERO)

    @property
    def total(self) -> Decimal:
        return self.federal + self.state + self.social_security + self.medicare


@dataclass(frozen=True)
class ScheduleEResult:
    """The phase 2 -> phase 1 boundary.

    `net` is the UNLIMITED result of the rental business. The engine, not
    phase 2, applies the passive activity loss limitation -- loss
    limitation is tax law and belongs with the tax math. See
    limitations.py.
    """
    gross_rental_income: Decimal
    allowable_expenses: Decimal
    net: Decimal
    active_participation: bool
    suspended_loss_carryin: Decimal

    @property
    def is_loss(self) -> bool:
        return self.net < ZERO


@dataclass(frozen=True)
class TaxInputs:
    filing_status: FilingStatus
    wages_ytd: Decimal
    projected_remaining_wages: Decimal
    pretax_401k: Decimal
    pretax_hsa: Decimal
    pretax_other: Decimal
    federal_withheld_ytd: Decimal
    state_withheld_ytd: Decimal
    ss_withheld_ytd: Decimal
    medicare_withheld_ytd: Decimal
    projected_remaining_withholding: WithholdingBuckets
    itemized_deductions: Decimal
    schedule_e: ScheduleEResult | None
    prior_year_total_tax: Decimal | None
    prior_year_agi: Decimal | None

    @property
    def total_wages(self) -> Decimal:
        return self.wages_ytd + self.projected_remaining_wages

    @property
    def withheld_ytd_total(self) -> Decimal:
        return (
            self.federal_withheld_ytd + self.state_withheld_ytd
            + self.ss_withheld_ytd + self.medicare_withheld_ytd
        )


@dataclass(frozen=True)
class ExplainStep:
    """One rule application, in the order the engine applied it. Backs the
    'show the work' principle -- built by the engine, never reconstructed
    by the UI."""
    label: str
    amount: Decimal
    detail: str


@dataclass(frozen=True)
class SafeHarborResult:
    status: Literal["met", "not_met", "unknown"]
    test_used: Literal["90_percent_current", "100_percent_prior",
                       "110_percent_prior", "none"]
    required_payment: Decimal | None
    projected_payment: Decimal | None
    shortfall: Decimal | None
    per_period_to_close: Decimal | None
    reason: str


@dataclass(frozen=True)
class TaxProjection:
    agi: Decimal
    magi_for_pal: Decimal
    deduction_taken: Decimal
    deduction_kind: Literal["standard", "itemized"]
    standard_deduction: Decimal
    itemized_total: Decimal
    taxable_income: Decimal
    federal_income_tax: Decimal
    social_security_tax: Decimal
    medicare_tax: Decimal
    additional_medicare_tax: Decimal
    state_tax: Decimal
    total_liability: Decimal
    total_withheld_projected: Decimal
    refund_or_amount_due: Decimal   # positive = refund, negative = owed
    effective_rate: Decimal
    schedule_e_allowed_loss: Decimal
    schedule_e_suspended_loss: Decimal
    safe_harbor: SafeHarborResult
    explain: list[ExplainStep]


class Change:
    """A hypothetical adjustment. impact_of() applies one and re-runs the
    engine. Phase 3 enumerates these; it adds no tax math of its own."""
    def apply(self, inputs: TaxInputs) -> TaxInputs:
        raise NotImplementedError


@dataclass(frozen=True)
class ExtraWages(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        # Adjust PROJECTED wages, never YTD actuals -- YTD is measured fact.
        return replace(
            inputs,
            projected_remaining_wages=inputs.projected_remaining_wages + self.amount,
        )


@dataclass(frozen=True)
class ExtraPretax401k(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        return replace(inputs, pretax_401k=inputs.pretax_401k + self.amount)


@dataclass(frozen=True)
class ExtraPretaxHsa(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        return replace(inputs, pretax_hsa=inputs.pretax_hsa + self.amount)


@dataclass(frozen=True)
class ExtraItemizedDeduction(Change):
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        return replace(
            inputs, itemized_deductions=inputs.itemized_deductions + self.amount
        )


@dataclass(frozen=True)
class ExtraBusinessExpense(Change):
    """A Schedule E expense. Reduces rental net dollar for dollar, which is
    why it is worth something even when itemized deductions are worth
    nothing -- but it may be limited if it creates a loss."""
    amount: Decimal

    def apply(self, inputs: TaxInputs) -> TaxInputs:
        if inputs.schedule_e is None:
            existing = ScheduleEResult(
                gross_rental_income=ZERO, allowable_expenses=ZERO, net=ZERO,
                active_participation=True, suspended_loss_carryin=ZERO,
            )
        else:
            existing = inputs.schedule_e
        return replace(
            inputs,
            schedule_e=replace(
                existing,
                allowable_expenses=existing.allowable_expenses + self.amount,
                net=existing.net - self.amount,
            ),
        )
