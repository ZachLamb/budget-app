"""Input types must be frozen (the engine perturbs by copy, never mutation)
and must keep deferral types separate."""
from __future__ import annotations

import dataclasses
from decimal import Decimal

import pytest

from app.services.tax.inputs import (
    ExtraPretax401k,
    ExtraWages,
    ScheduleEResult,
    TaxInputs,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import FilingStatus


def _minimal_inputs(**overrides) -> TaxInputs:
    base = dict(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=Decimal("100000"),
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


def test_tax_inputs_are_frozen():
    inputs = _minimal_inputs()
    with pytest.raises(dataclasses.FrozenInstanceError):
        inputs.wages_ytd = Decimal("1")  # type: ignore[misc]


def test_deferral_types_are_separate_fields():
    """401(k) and HSA hit different tax bases; one lumped total cannot
    express that. Guard against a future 'simplification'."""
    names = {f.name for f in dataclasses.fields(TaxInputs)}
    assert {"pretax_401k", "pretax_hsa", "pretax_other"} <= names
    assert "pretax_total" not in names


def test_total_wages_sums_ytd_and_projected():
    inputs = _minimal_inputs(
        wages_ytd=Decimal("120000"), projected_remaining_wages=Decimal("59000")
    )
    assert inputs.total_wages == Decimal("179000")


def test_withholding_buckets_total():
    buckets = WithholdingBuckets(
        federal=Decimal("100"), state=Decimal("20"),
        social_security=Decimal("62"), medicare=Decimal("15"),
    )
    assert buckets.total == Decimal("197")
    assert WithholdingBuckets.zero().total == Decimal("0")


def test_schedule_e_net_is_supplied_unlimited():
    """Phase 2 supplies the UNLIMITED net; the engine applies the passive
    loss limit. Confirm the carry-in field exists for that calculation."""
    result = ScheduleEResult(
        gross_rental_income=Decimal("30000"),
        allowable_expenses=Decimal("48000"),
        net=Decimal("-18000"),
        active_participation=True,
        suspended_loss_carryin=Decimal("4000"),
    )
    assert result.net == Decimal("-18000")
    assert result.is_loss is True


def test_change_types_apply_to_the_right_field():
    inputs = _minimal_inputs()
    bumped = ExtraWages(Decimal("1000")).apply(inputs)
    assert bumped.projected_remaining_wages == Decimal("1000")
    assert bumped.wages_ytd == inputs.wages_ytd, "must not mutate YTD actuals"

    deferred = ExtraPretax401k(Decimal("5000")).apply(inputs)
    assert deferred.pretax_401k == Decimal("5000")
    assert deferred.total_wages == inputs.total_wages, "deferral is not income"
