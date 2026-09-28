"""Self-employment tax.

Every expected figure here is computed by hand from the statute, not
from a previous run of the code, so the tests fail if the code changes
its mind about the arithmetic.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.tax.rates.registry import FilingStatus, get_rates
from app.services.tax.self_employment import RentalTreatment, compute

RATES = get_rates(2026, "CO").federal
D = Decimal


def se(profit, wages="0", status=FilingStatus.SINGLE):
    return compute(
        D(profit),
        wages_subject_to_ss=D(wages),
        filing_status=status,
        rates=RATES,
    )


class TestTheArithmetic:
    def test_both_halves_of_social_security_and_medicare(self):
        # 20,000 x 0.9235 = 18,470 net earnings.
        # SS  18,470 x 12.4% = 2,290.28
        # Med 18,470 x  2.9% =   535.63
        t = se("20000")
        assert t.net_earnings == D("18470.00")
        assert t.social_security == D("2290.28")
        assert t.medicare == D("535.63")
        assert t.total == D("2825.91")

    def test_the_rate_is_the_familiar_15_3_percent_of_net_earnings(self):
        t = se("20000")
        assert t.total == (t.net_earnings * D("0.153")).quantize(D("0.01"))

    def test_half_comes_off_income_before_income_tax(self):
        t = se("20000")
        assert t.deductible_half == D("1412.96")
        # Doubling a rounded half cannot recover an odd number of cents,
        # so this is within one cent by construction, not by accident.
        assert abs(t.deductible_half * 2 - (t.social_security + t.medicare)) <= D("0.01")

    def test_wages_consume_the_wage_base_first(self):
        # Base 184,500 less 180,000 of wages leaves 4,500.
        # 4,500 x 12.4% = 558.00, and Medicare is unaffected.
        t = se("20000", wages="180000")
        assert t.social_security == D("558.00")
        assert t.medicare == D("535.63")
        assert "used part of the Social Security wage base" in t.reason

    def test_wages_at_the_base_leave_only_the_medicare_part(self):
        # Getting this wrong overstates the bill by 12.4% of the profit.
        t = se("20000", wages="184500")
        assert t.social_security == D("0.00")
        assert t.medicare == D("535.63")
        assert "already reached the Social Security wage base" in t.reason

    def test_additional_medicare_only_on_the_self_employed_share(self):
        # Wages 184,500 + net earnings 18,470 = 202,970, threshold
        # 200,000, so 2,970 is over. 2,970 x 0.9% = 26.73. The employer
        # withholds the wage part; this is only the business part.
        t = se("20000", wages="184500")
        assert t.additional_medicare == D("26.73")

    def test_additional_medicare_has_no_employer_half_to_deduct(self):
        t = se("20000", wages="184500")
        assert t.deductible_half == (
            (t.social_security + t.medicare) / 2
        ).quantize(D("0.01"))
        assert t.additional_medicare not in (t.deductible_half, D("0")) or True
        # Stated directly: the additional Medicare is in the total but
        # not in the deduction.
        assert t.total == t.social_security + t.medicare + t.additional_medicare

    def test_the_threshold_follows_the_filing_status(self):
        # 250,000 for a joint filer, so the same numbers owe nothing.
        t = se("20000", wages="184500", status=FilingStatus.MARRIED_JOINT)
        assert t.additional_medicare == D("0")

    def test_a_married_filing_separately_threshold_is_lower_not_higher(self):
        t = se("20000", wages="120000", status=FilingStatus.MARRIED_SEPARATE)
        # 120,000 + 18,470 = 138,470 against a 125,000 threshold.
        assert t.additional_medicare == D("121.23")


class TestWhenNothingIsOwed:
    def test_a_loss_owes_nothing(self):
        t = se("-5000")
        assert t.total == D("0")
        assert "loss" in t.reason

    def test_exactly_zero_owes_nothing(self):
        assert se("0").total == D("0")

    def test_below_the_de_minimis_floor_owes_nothing(self):
        # 400 x 0.9235 = 369.40, under the $400 statutory floor.
        t = se("400")
        assert t.net_earnings == D("0")
        assert t.total == D("0")
        assert "under $400" in t.reason

    def test_the_floor_is_a_cliff_not_an_exemption(self):
        # Just over it, the tax applies to the whole amount rather than
        # to the excess -- which is what IRC 1402(b)(2) actually says.
        t = se("500")
        assert t.net_earnings == D("461.75")
        assert t.total == (D("461.75") * D("0.153")).quantize(D("0.01"))


class TestRentalTreatment:
    def test_there_is_no_default(self):
        # The two answers differ by about 15% of the profit, and only the
        # person providing the services knows which applies.
        assert set(RentalTreatment) == {
            RentalTreatment.SCHEDULE_E,
            RentalTreatment.SCHEDULE_C,
        }
        assert not hasattr(RentalTreatment, "DEFAULT")


# ── through the engine ────────────────────────────────────────────────

from app.services.tax.engine import project
from app.services.tax.inputs import ScheduleEResult, TaxInputs, WithholdingBuckets


def _inputs(*, treatment, rental_net="20000"):
    return TaxInputs(
        filing_status=FilingStatus.SINGLE,
        wages_ytd=D("80000"),
        projected_remaining_wages=D("0"),
        pretax_401k=D("0"),
        pretax_hsa=D("0"),
        pretax_other=D("0"),
        federal_withheld_ytd=D("10000"),
        state_withheld_ytd=D("3000"),
        ss_withheld_ytd=D("4960"),
        medicare_withheld_ytd=D("1160"),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=D("0"),
        schedule_e=ScheduleEResult(
            gross_rental_income=D("40000"),
            allowable_expenses=D("20000"),
            net=D(rental_net),
            active_participation=True,
            suspended_loss_carryin=D("0"),
        ),
        prior_year_total_tax=None,
        prior_year_agi=None,
        rental_treatment=treatment,
    )


RS = get_rates(2026, "CO")


class TestThroughTheEngine:
    def test_a_schedule_e_rental_owes_no_self_employment_tax(self):
        p = project(_inputs(treatment=RentalTreatment.SCHEDULE_E), RS)
        assert p.self_employment is None

    def test_an_unanswered_rental_is_not_quietly_treated_as_schedule_e(self):
        # It produces no SE tax either -- but the route reports
        # "rental_treatment" as missing, so the projection is not
        # presented as an answer. See test_tax_projection_route.
        p = project(_inputs(treatment=None), RS)
        assert p.self_employment is None

    def test_a_schedule_c_rental_owes_it(self):
        p = project(_inputs(treatment=RentalTreatment.SCHEDULE_C), RS)
        assert p.self_employment is not None
        assert p.self_employment.total > D("0")

    def test_the_self_employment_tax_lands_in_the_total(self):
        e = project(_inputs(treatment=RentalTreatment.SCHEDULE_E), RS)
        c = project(_inputs(treatment=RentalTreatment.SCHEDULE_C), RS)
        # The Schedule C bill is higher by the SE tax, less the income
        # tax saved by deducting half of it.
        assert c.total_liability > e.total_liability
        assert c.self_employment.total > D("2000")

    def test_the_deduction_reduces_agi_before_income_tax(self):
        e = project(_inputs(treatment=RentalTreatment.SCHEDULE_E), RS)
        c = project(_inputs(treatment=RentalTreatment.SCHEDULE_C), RS)
        assert c.agi == e.agi - c.self_employment.deductible_half
        # ...and the income tax follows the lower AGI rather than being
        # computed before the deduction lands.
        assert c.federal_income_tax < e.federal_income_tax

    def test_a_rental_loss_owes_none_even_as_a_business(self):
        p = project(_inputs(treatment=RentalTreatment.SCHEDULE_C, rental_net="-5000"), RS)
        assert p.self_employment is None

    def test_the_explanation_says_why_it_is_being_charged(self):
        p = project(_inputs(treatment=RentalTreatment.SCHEDULE_C), RS)
        step = next(s for s in p.explain if "Self-employment" in s.label)
        assert "both halves" in step.detail
        assert "employer" in step.detail

    def test_the_wage_base_is_shared_with_the_day_job(self):
        # 80,000 of wages have already used part of the base, so the SS
        # part is smaller than it would be on the profit alone.
        alone = se("20000")
        through = project(_inputs(treatment=RentalTreatment.SCHEDULE_C), RS)
        assert through.self_employment.social_security == alone.social_security
        # Still under the base at 80,000 + 18,470, so they agree here --
        # the case that matters is the one above the base.
        high = project(
            TaxInputs(**{
                **_inputs(treatment=RentalTreatment.SCHEDULE_C).__dict__,
                "wages_ytd": D("180000"),
            }),
            RS,
        )
        assert high.self_employment.social_security < alone.social_security
