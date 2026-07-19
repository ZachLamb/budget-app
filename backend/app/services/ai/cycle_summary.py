"""Deterministic assembler for the pay-cycle summary facts.

This composes already-computed component facts (spending patterns, budget
overspend, pay-cycle progress, open commitments) into one compact payload that
is *the* grounding for the on-device "how's this cycle going?" narration.

The value here is deterministic and testable: it decides what is worth saying
(the real movers, the real overspend, the honest next step) and nothing else,
so the model can only narrate facts it is handed — it can't invent numbers or a
rosier picture. The narration prose itself needs a model and is verified where
one is available; this scaffold does not.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, CycleCommitment, Household, Transaction
from app.services.ai.budget import compute_budget_facts, compute_spending_patterns


def _next_step(cycle_steps: dict[str, bool], open_commitments: int) -> str:
    """The single honest next action for this window, from cycle state alone."""
    if not cycle_steps.get("observed"):
        return "review this window's spending"
    if not cycle_steps.get("diagnosed"):
        return "identify what drove the changes"
    if not cycle_steps.get("decided"):
        return "decide on an adjustment"
    if open_commitments > 0:
        return f"follow through on {open_commitments} commitment" + (
            "s" if open_commitments != 1 else ""
        )
    return "you're on track — nothing needs attention"


def assemble_cycle_summary(
    *,
    window_label: str,
    income_in_window: float,
    spent_in_window: float,
    spending_patterns: list[dict[str, Any]],
    overspent: list[dict[str, Any]],
    cycle_steps: dict[str, bool],
    open_commitments: int,
    max_movers: int = 3,
    max_overspent: int = 3,
) -> dict[str, Any]:
    """Build the compact, narration-ready cycle-summary facts payload.

    - ``top_movers``: non-stable category changes, largest absolute % first.
    - ``overspent``: categories over budget, largest overage first.
    Both are capped so the prompt stays small and focused. Deterministic:
    identical inputs always produce identical output.
    """
    movers = [
        {
            "category": p["category"],
            "direction": p["trend"],
            "pct_change": p["pct_change"],
        }
        for p in spending_patterns
        if p.get("trend") in ("up", "down")
    ]
    movers.sort(key=lambda m: abs(m["pct_change"]), reverse=True)

    over = sorted(
        (
            {"category": o["category"], "over_by": round(float(o["over_by"]), 2)}
            for o in overspent
            if float(o.get("over_by", 0)) > 0
        ),
        key=lambda o: o["over_by"],
        reverse=True,
    )

    income = round(float(income_in_window), 2)
    spent = round(float(spent_in_window), 2)
    return {
        "window": window_label,
        "income": income,
        "spent": spent,
        "net": round(income - spent, 2),
        "top_movers": movers[:max_movers],
        "overspent": over[:max_overspent],
        "cycle_progress": {
            "observed": bool(cycle_steps.get("observed")),
            "diagnosed": bool(cycle_steps.get("diagnosed")),
            "decided": bool(cycle_steps.get("decided")),
        },
        "open_commitments": open_commitments,
        "next_step": _next_step(cycle_steps, open_commitments),
    }


async def compute_cycle_summary_facts(
    db: AsyncSession, household_id: str
) -> dict[str, Any]:
    """Gather real component facts and compose the cycle-summary payload.

    Thin integration over already-tested pieces: current-month income/spend on
    budget accounts, ``compute_spending_patterns`` movers, ``compute_budget_facts``
    overspend, the household's observe/diagnose/decide stamps, and its open
    commitment count — all funneled through the deterministic assembler.
    """
    today = date.today()

    budget_accounts = (
        select(Account.id)
        .where(
            Account.household_id == household_id,
            Account.is_budget_account.is_(True),
            Account.closed_at.is_(None),
        )
        .scalar_subquery()
    )

    def _month_sum(positive: bool):
        cond = Transaction.amount > 0 if positive else Transaction.amount < 0
        return select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.account_id.in_(budget_accounts),
            extract("year", Transaction.date) == today.year,
            extract("month", Transaction.date) == today.month,
            cond,
        )

    income = float(await db.scalar(_month_sum(True)) or 0)
    spent = abs(float(await db.scalar(_month_sum(False)) or 0))

    patterns = (await compute_spending_patterns(db, household_id))["patterns"]
    budget = await compute_budget_facts(db, household_id)
    overspent = [
        {"category": c["name"], "over_by": -c["remaining"]}
        for c in budget["categories"]
        if c["remaining"] < 0
    ]

    household = await db.get(Household, household_id)
    cycle_steps = {
        "observed": bool(household and household.cycle_observed_at is not None),
        "diagnosed": bool(household and household.cycle_diagnosed_at is not None),
        "decided": bool(household and household.cycle_decide_ack),
    }

    open_commitments = int(
        await db.scalar(
            select(func.count())
            .select_from(CycleCommitment)
            .where(
                CycleCommitment.household_id == household_id,
                CycleCommitment.status == "active",
            )
        )
        or 0
    )

    return assemble_cycle_summary(
        window_label=today.strftime("%B %Y"),
        income_in_window=income,
        spent_in_window=spent,
        spending_patterns=patterns,
        overspent=overspent,
        cycle_steps=cycle_steps,
        open_commitments=open_commitments,
    )
