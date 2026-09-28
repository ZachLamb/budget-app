"""Self-employment tax.

An employee's Social Security and Medicare are split with their
employer, and the employer's half never appears on a paystub. Someone
self-employed pays both halves themselves, on Schedule SE. On a
profitable side business that is roughly 15.3% arriving on top of income
tax, and it is the single most common reason a first-year filer owes far
more than they expected.

Whether a short-term rental owes it at all depends on how the activity
is reported, which is a question about the activity and not one this
module can answer -- see `RentalTreatment`. Nothing here is applied
until that question has been answered.

Figures: the 92.35% factor and the 50% deduction are IRC 1402(a)(12)
and 164(f); rates and wage base come from the rate registry, not from
constants here.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from app.services.tax.rates.registry import FederalRates, FilingStatus

ZERO = Decimal("0")

#: Net earnings from self-employment are 92.35% of net profit. The
#: reduction stands in for the employer-half deduction an employee never
#: sees, so the two are taxed on comparable ground. IRC 1402(a)(12).
_NET_EARNINGS_FACTOR = Decimal("0.9235")

#: Below this, no SE tax is owed at all. IRC 1402(b)(2) -- and it is a
#: cliff, not a floor: at $400.01 the tax applies to the whole amount.
_DE_MINIMIS = Decimal("400")


class RentalTreatment(StrEnum):
    """How a rental is reported, which decides whether SE tax applies.

    Renting property is normally passive income on Schedule E and owes
    no self-employment tax. It becomes a Schedule C business -- and does
    owe it -- when substantial services are provided to the occupant:
    daily cleaning during the stay, meals, linen changes, tours. Cleaning
    between guests, supplying linen, and paying the utilities are not
    substantial services and leave the activity on Schedule E.

    There is no default. The answer turns on what is actually provided,
    which only the person who provides it knows, and the difference on a
    profitable rental is about 15% of the profit. Guessing either way
    would be inventing a number.
    """

    SCHEDULE_E = "schedule_e"
    SCHEDULE_C = "schedule_c"


@dataclass(frozen=True)
class SelfEmploymentTax:
    net_profit: Decimal
    net_earnings: Decimal
    social_security: Decimal
    medicare: Decimal
    additional_medicare: Decimal
    total: Decimal
    #: Half the SE tax comes off income before income tax is worked out.
    #: Above-the-line, so it applies whether or not you itemize.
    deductible_half: Decimal
    #: Why the Social Security half is what it is -- wages already used
    #: up part of the wage base, or the profit was too small to count.
    reason: str


def compute(
    net_profit: Decimal,
    *,
    wages_subject_to_ss: Decimal,
    filing_status: FilingStatus,
    rates: FederalRates,
) -> SelfEmploymentTax:
    """Self-employment tax on a net profit.

    `wages_subject_to_ss` is W-2 wages already taxed for Social Security
    this year. They consume the wage base first, so someone who has
    already hit it through their job owes only the Medicare portion on
    their business -- getting this wrong overstates the bill by up to
    12.4% of the profit.
    """
    if net_profit <= ZERO:
        return _nothing(net_profit, "A loss owes no self-employment tax.")

    net_earnings = (net_profit * _NET_EARNINGS_FACTOR).quantize(Decimal("0.01"))

    if net_earnings < _DE_MINIMIS:
        return _nothing(
            net_profit,
            f"Net earnings under ${_DE_MINIMIS} owe no self-employment tax.",
        )

    # Wages eat into the wage base before self-employment earnings do.
    remaining_base = rates.social_security_wage_base - wages_subject_to_ss
    if remaining_base < ZERO:
        remaining_base = ZERO
    ss_earnings = min(net_earnings, remaining_base)
    # Both halves: 6.2% employee + 6.2% employer.
    social_security = (ss_earnings * rates.social_security_rate * 2).quantize(
        Decimal("0.01")
    )

    if remaining_base == ZERO:
        reason = (
            "Your wages already reached the Social Security wage base of "
            f"${rates.social_security_wage_base:,.0f}, so only the Medicare "
            "part applies to your business profit."
        )
    elif ss_earnings < net_earnings:
        reason = (
            "Your wages used part of the Social Security wage base, so only "
            f"${ss_earnings:,.0f} of the profit is subject to that part."
        )
    else:
        reason = "The full profit is subject to both parts."

    medicare = (net_earnings * rates.medicare_rate * 2).quantize(Decimal("0.01"))

    # Additional Medicare is charged on wages and self-employment
    # earnings together, and the wages have already used up their share
    # of the threshold. Unlike the rest of SE tax, this one has no
    # employer half -- the employee pays it alone.
    threshold = rates.additional_medicare_threshold[filing_status]
    combined = wages_subject_to_ss + net_earnings
    over = combined - threshold
    if over <= ZERO:
        additional_medicare = ZERO
    else:
        # Only the part of the excess attributable to SE earnings; the
        # wage part is withheld by the employer.
        se_share = min(over, net_earnings)
        additional_medicare = (se_share * rates.additional_medicare_rate).quantize(
            Decimal("0.01")
        )

    total = social_security + medicare + additional_medicare
    # The deduction is half of the Social Security and Medicare parts
    # only. Additional Medicare has no employer half, so none of it is
    # deductible. IRC 164(f).
    deductible_half = ((social_security + medicare) / 2).quantize(Decimal("0.01"))

    return SelfEmploymentTax(
        net_profit=net_profit,
        net_earnings=net_earnings,
        social_security=social_security,
        medicare=medicare,
        additional_medicare=additional_medicare,
        total=total,
        deductible_half=deductible_half,
        reason=reason,
    )


def _nothing(net_profit: Decimal, reason: str) -> SelfEmploymentTax:
    return SelfEmploymentTax(
        net_profit=net_profit,
        net_earnings=ZERO,
        social_security=ZERO,
        medicare=ZERO,
        additional_medicare=ZERO,
        total=ZERO,
        deductible_half=ZERO,
        reason=reason,
    )
