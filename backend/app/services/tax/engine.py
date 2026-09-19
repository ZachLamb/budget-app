"""The tax engine. A pure function of its arguments.

No database session, no network, no clock. This is what makes it
testable against published IRS examples and safe for the phase 3
optimizer to re-run with perturbed inputs.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from app.services.tax.inputs import (
    ZERO,
    Change,
    ExplainStep,
    SafeHarborResult,
    TaxInputs,
    TaxProjection,
)
from app.services.tax.limitations import allowed_rental_loss
from app.services.tax.rates.registry import (
    FilingStatus,
    RateSet,
    UnsupportedFilingStatusError,
)
from app.services.tax.safe_harbor import evaluate_safe_harbor

CENTS = Decimal("0.01")


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _bracket_tax(taxable: Decimal, brackets) -> Decimal:
    """Progressive tax. Each bracket's rate applies only to the income
    inside it -- never the whole amount."""
    tax = ZERO
    lower = ZERO
    for bracket in brackets:
        if bracket.upper is None or taxable <= bracket.upper:
            return tax + (taxable - lower) * bracket.rate
        tax += (bracket.upper - lower) * bracket.rate
        lower = bracket.upper
    return tax


def project(inputs: TaxInputs, rates: RateSet, remaining_periods: int = 0) -> TaxProjection:
    if inputs.filing_status not in rates.supported_statuses:
        raise UnsupportedFilingStatusError(
            f"{inputs.filing_status} is not populated for {rates.year}. "
            "Approximating with another status would be wrong by thousands; "
            "add its sourced rate table instead."
        )

    explain: list[ExplainStep] = []
    fed = rates.federal

    # --- Wage bases -----------------------------------------------------
    # 401(k) reduces income tax but NOT the FICA wage base. HSA reduces
    # both. Reversing this overstates a deferral's value by ~27%.
    gross_wages = inputs.total_wages
    fica_wages = gross_wages - inputs.pretax_hsa - inputs.pretax_other
    income_tax_wages = fica_wages - inputs.pretax_401k

    explain.append(ExplainStep(
        "Wages", _cents(gross_wages),
        "Year-to-date actuals plus projected remaining pay.",
    ))

    # MAGI for the passive-loss phase-out EXCLUDES the passive loss itself
    # (IRS Pub 925) -- which is why this is a single forward pass and not
    # a fixed-point solve. See limitations.py.
    magi_for_pal = income_tax_wages

    if inputs.schedule_e is None:
        allowed_loss = ZERO
        suspended_loss = ZERO
        schedule_e_contribution = ZERO
    else:
        allowance = allowed_rental_loss(
            magi_for_pal,
            inputs.schedule_e.net,
            inputs.schedule_e.active_participation,
            rates.passive_loss,
        )
        if inputs.schedule_e.is_loss:
            allowed_loss = allowance.allowed
            suspended_loss = allowance.suspended
            schedule_e_contribution = -allowance.allowed
            explain.append(ExplainStep(
                "Rental loss allowed this year", _cents(allowed_loss),
                f"Of {_cents(-inputs.schedule_e.net)} in rental loss, "
                f"{_cents(suspended_loss)} is suspended and carries forward "
                "because your income is above the passive-loss threshold."
                if suspended_loss > ZERO else
                "Your full rental loss is usable this year.",
            ))
        else:
            allowed_loss = ZERO
            suspended_loss = ZERO
            schedule_e_contribution = inputs.schedule_e.net
            explain.append(ExplainStep(
                "Rental income", _cents(inputs.schedule_e.net),
                "Net rental income after expenses and depreciation.",
            ))

    agi = income_tax_wages + schedule_e_contribution
    explain.append(ExplainStep(
        "Adjusted gross income", _cents(agi),
        "Wages less pre-tax deferrals, plus rental income or allowed loss.",
    ))

    # --- Deduction ------------------------------------------------------
    standard = fed.standard_deduction[inputs.filing_status]
    itemized = inputs.itemized_deductions
    if itemized > standard:
        deduction_taken, deduction_kind = itemized, "itemized"
        detail = "Itemized deductions exceed the standard deduction."
    else:
        deduction_taken, deduction_kind = standard, "standard"
        detail = (
            f"Standard deduction applies. Itemized deductions total "
            f"{_cents(itemized)}, which is below it, so they reduce your "
            f"tax by nothing this year."
        )
    explain.append(ExplainStep("Deduction", _cents(deduction_taken), detail))

    taxable_income = max(ZERO, agi - deduction_taken)
    explain.append(ExplainStep(
        "Taxable income", _cents(taxable_income),
        "Adjusted gross income less your deduction, floored at zero.",
    ))

    # --- Federal income tax ---------------------------------------------
    federal_income_tax = _cents(
        _bracket_tax(taxable_income, fed.brackets[inputs.filing_status])
    )
    explain.append(ExplainStep(
        "Federal income tax", federal_income_tax,
        "Each bracket's rate applied only to the income inside it.",
    ))

    # --- FICA ------------------------------------------------------------
    ss_base = min(fica_wages, fed.social_security_wage_base)
    social_security_tax = _cents(ss_base * fed.social_security_rate)
    medicare_tax = _cents(fica_wages * fed.medicare_rate)
    additional_medicare_tax = _cents(
        max(ZERO, fica_wages - fed.additional_medicare_threshold)
        * fed.additional_medicare_rate
    )
    explain.append(ExplainStep(
        "Social Security", social_security_tax,
        f"6.2% on wages up to {_cents(fed.social_security_wage_base)}. "
        "Pre-tax 401(k) does not reduce this.",
    ))
    explain.append(ExplainStep(
        "Medicare", medicare_tax + additional_medicare_tax,
        "1.45% on all wages, plus 0.9% above "
        f"{_cents(fed.additional_medicare_threshold)}.",
    ))

    # --- State -----------------------------------------------------------
    state_tax = _cents(taxable_income * rates.state.flat_rate)
    explain.append(ExplainStep(
        f"{rates.state.code} income tax", state_tax,
        f"{rates.state.flat_rate * 100}% flat on federal taxable income.",
    ))

    total_liability = _cents(
        federal_income_tax + social_security_tax + medicare_tax
        + additional_medicare_tax + state_tax
    )
    total_withheld = _cents(
        inputs.withheld_ytd_total + inputs.projected_remaining_withholding.total
    )
    refund_or_amount_due = _cents(total_withheld - total_liability)

    effective_rate = (
        _cents(total_liability / gross_wages * 100) if gross_wages > ZERO else ZERO
    )

    return TaxProjection(
        agi=_cents(agi),
        magi_for_pal=_cents(magi_for_pal),
        deduction_taken=_cents(deduction_taken),
        deduction_kind=deduction_kind,
        standard_deduction=_cents(standard),
        itemized_total=_cents(itemized),
        taxable_income=_cents(taxable_income),
        federal_income_tax=federal_income_tax,
        social_security_tax=social_security_tax,
        medicare_tax=medicare_tax,
        additional_medicare_tax=additional_medicare_tax,
        state_tax=state_tax,
        total_liability=total_liability,
        total_withheld_projected=total_withheld,
        refund_or_amount_due=refund_or_amount_due,
        effective_rate=effective_rate,
        schedule_e_allowed_loss=_cents(allowed_loss),
        schedule_e_suspended_loss=_cents(suspended_loss),
        safe_harbor=evaluate_safe_harbor(
            total_liability=total_liability,
            projected_withholding=total_withheld,
            prior_year_total_tax=inputs.prior_year_total_tax,
            prior_year_agi=inputs.prior_year_agi,
            remaining_periods=remaining_periods,
        ),
        explain=explain,
    )


def impact_of(inputs: TaxInputs, change: Change, rates: RateSet) -> Decimal:
    """Dollars of ADDITIONAL tax from applying `change`. Negative means the
    change reduces tax.

    This is the engine's entire marginal surface. It perturbs by the
    ACTUAL amount under consideration rather than a fixed step, because a
    fixed step gives a step-dependent answer near a bracket edge -- at
    wages just below one, a $1 step and a $10,000 step differ by ten
    percentage points. Callers that want a percentage divide by the
    amount and label it as blended over that amount.

    `inputs` is never mutated; Change.apply() returns a copy.
    """
    base = project(inputs, rates).total_liability
    changed = project(change.apply(inputs), rates).total_liability
    return _cents(changed - base)
