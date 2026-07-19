"""Deterministic subscription price-increase detection.

Given each subscription's charge history, flag the ones whose latest charge is a
genuine step up in price — the "Netflix went $15.49 → $15.99" nudge that makes
people actually review a subscription.

Pure and side-effect-free for unit testing. Conservative by design: we only flag
when the most recent charge is a strict new high versus *every* prior charge,
which suppresses cent-level wobble on variable charges and one-off returns to a
former price. No model is involved — an on-device pass may later phrase the
alert, but the detection stands alone.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PriceChange:
    key: str  # payee name (or id) the series belongs to
    previous_amount: float
    current_amount: float
    pct_change: float  # percent increase from previous to current


def detect_price_changes(
    series_by_key: dict[str, list[float]],
    *,
    min_pct: float = 1.0,
    min_abs: float = 0.50,
    limit: int = 20,
) -> list[PriceChange]:
    """Flag subscriptions whose latest charge is a meaningful new-high increase.

    Each series is that subscription's charge amounts as positive numbers in
    chronological order (oldest → newest). A change is reported when the last
    charge exceeds the maximum of all earlier charges by at least ``min_pct``
    percent *and* ``min_abs`` in absolute terms. ``previous_amount`` is that
    earlier maximum — the established price. Results are sorted by percent
    increase descending and capped at ``limit``. Deterministic.
    """
    changes: list[PriceChange] = []
    for key, amounts in series_by_key.items():
        cleaned = [abs(float(a)) for a in amounts]
        if len(cleaned) < 2:
            continue
        current = cleaned[-1]
        baseline = max(cleaned[:-1])
        if baseline <= 0:
            continue
        delta = current - baseline
        if delta < min_abs:
            continue
        pct = delta / baseline * 100
        if pct < min_pct:
            continue
        changes.append(
            PriceChange(
                key=key,
                previous_amount=round(baseline, 2),
                current_amount=round(current, 2),
                pct_change=round(pct, 1),
            )
        )

    changes.sort(key=lambda c: (c.pct_change, c.key), reverse=True)
    return changes[:limit]
