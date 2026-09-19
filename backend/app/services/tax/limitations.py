"""Passive activity loss limitation (IRS Publication 925).

A rental loss is not automatically usable against W2 income. A special
allowance of $25,000 is reduced by 50% of modified AGI over $100,000 and
is gone entirely at $150,000. The unused portion is SUSPENDED and
carries forward -- it is not lost, but it does not help this year.

CRITICAL IMPLEMENTATION NOTE
----------------------------
The allowance depends on MAGI, and MAGI looks like it depends on the
loss, which looks circular. It is not. Pub 925 defines MAGI for this
purpose to EXCLUDE the passive loss itself, so this is a single forward
pass with no fixed-point solve.

Implementing it the intuitive way -- using AGI after the loss has been
applied -- gives a different and WRONG answer: at $120,000 of wages with
an $18,000 loss, the correct allowance is $15,000, but AGI-after-loss
($102,000) yields $18,000. Do not "simplify" this.

https://www.irs.gov/publications/p925
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.services.tax.rates.registry import PassiveLossRates

ZERO = Decimal("0")
HALF = Decimal("0.5")


@dataclass(frozen=True)
class LossAllowance:
    allowed: Decimal     # positive magnitude usable this year
    suspended: Decimal   # positive magnitude carried forward


def allowed_rental_loss(
    magi: Decimal,
    rental_net: Decimal,
    active_participation: bool,
    rates: PassiveLossRates,
) -> LossAllowance:
    """`magi` must EXCLUDE the passive loss (see module docstring).

    `rental_net` is signed: negative is a loss, positive is income.
    Income is never limited and passes through untouched.
    """
    if rental_net >= ZERO:
        return LossAllowance(allowed=rental_net, suspended=ZERO)

    loss = -rental_net

    if not active_participation:
        return LossAllowance(allowed=ZERO, suspended=loss)

    if magi <= rates.phaseout_start:
        allowance = rates.max_allowance
    elif magi >= rates.phaseout_end:
        allowance = ZERO
    else:
        allowance = rates.max_allowance - (magi - rates.phaseout_start) * HALF

    allowed = min(loss, allowance)
    return LossAllowance(allowed=allowed, suspended=loss - allowed)
