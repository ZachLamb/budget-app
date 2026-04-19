"""Unit tests for hybrid debt ordering."""
from __future__ import annotations

from decimal import Decimal

from app.api.routes.debt import hybrid_order_debts


def _d(aid: str, apr: str, bal: str) -> dict:
    return {"id": aid, "name": aid, "balance": Decimal(bal), "apr": Decimal(apr), "min_payment": Decimal("25")}


def test_hybrid_default_sorts_apr_then_balance() -> None:
    debts = [
        _d("a", "0.05", "1000"),
        _d("b", "0.20", "500"),
        _d("c", "0.20", "200"),
    ]
    out = hybrid_order_debts(debts, None)
    assert [d["id"] for d in out] == ["c", "b", "a"]


def test_hybrid_priority_prefix_then_rest() -> None:
    debts = [
        _d("low", "0.05", "100"),
        _d("high", "0.25", "9999"),
    ]
    out = hybrid_order_debts(debts, ["low", "high"])
    assert [d["id"] for d in out] == ["low", "high"]
