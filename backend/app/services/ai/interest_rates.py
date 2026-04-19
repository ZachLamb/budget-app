from __future__ import annotations

"""Interest rate suggestions — /suggest-interest-rates.

SimpleFIN does not provide interest rates. We ask the LLM for typical APR /
minimum payment estimates based on account name and type as a starting point
for the user to review and correct.
"""

import json
import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account
from app.services.ai import llm_client

logger = logging.getLogger(__name__)


async def suggest_interest_rates(
    db: AsyncSession, household_id: str
) -> dict[str, object]:
    """Return a dict shaped for `InterestRateSuggestionsResponse`."""
    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.account_type.in_(["credit", "loan"]))
        .where(Account.closed_at.is_(None))
    )
    accounts = acct_result.scalars().all()

    missing = [a for a in accounts if a.interest_rate is None or a.minimum_payment is None]
    if not missing:
        return {
            "suggestions": [],
            "model_source": "none",
            "note": "All accounts already have interest rate data.",
        }

    from app.api.routes.accounts import _compute_balances
    balances = await _compute_balances(db, missing)

    lines = []
    for a in missing:
        bal = abs(balances.get(a.id, Decimal("0")))
        lines.append(f'  - Name: "{a.name}", Type: {a.account_type}, Balance: ${bal:,.2f}')

    context = "\n".join(lines)
    prompt = f"""The following are credit card or loan accounts. Give a
plausible starting-point estimate of APR and minimum monthly payment for
each, as a STARTING POINT the user will verify against their statement.

Use broad ranges only — you cannot know the user's actual rate:
- Credit cards (general purpose): 18-26%
- Store cards / retail cards: 27-32%
- Mortgages: 5-8%
- Auto loans: 5-10%
- Personal loans / unsecured installment: 9-18%
- Student loans (federal): 4-8%; student loans (private): 8-15%

Pick a midpoint of the relevant range for each account. Do not quote
specific issuer rates, promotional rates, or introductory APRs — those
depend on the user's credit profile and statement, which you don't have.
Round APR to 2 decimal places as a percentage (e.g. 22.50).

For minimum payment use the greater of $25 or 2% of balance.

Accounts:
{context}

Return JSON:
{{"suggestions": [{{"account_name": "...", "apr_percent": 22.50, "min_payment": 35.00, "reasoning": "one line — start with 'Typical range for ...'"}}]}}
No other text."""

    response, source = await llm_client.complete_with_source(prompt, json_format=True)
    suggestions: list[dict[str, object]] = []

    if response:
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            raw = json.loads(text).get("suggestions", [])
            name_to_acct = {a.name: a for a in missing}
            for item in raw:
                acct = name_to_acct.get(item.get("account_name", ""))
                if not acct:
                    continue
                apr_pct = float(item.get("apr_percent", 0))
                min_pay = float(item.get("min_payment", 0))
                if not (0 < apr_pct < 100):
                    continue
                suggestions.append(
                    {
                        "account_id": acct.id,
                        "account_name": acct.name,
                        "suggested_apr": round(apr_pct / 100, 6),  # store as decimal
                        "suggested_min_payment": round(min_pay, 2),
                        "reasoning": str(item.get("reasoning", ""))[:200],
                    }
                )
        except Exception as e:
            logger.warning(
                "Interest rate suggestions: failed to parse LLM JSON: %s", e, exc_info=True
            )

    return {
        "suggestions": suggestions,
        "model_source": source,
        "note": (
            "These are rough starting-point estimates only. Your actual APR depends on "
            "your credit profile, card product, and any promotional period — always check "
            "your statement or cardholder agreement and correct these values before relying "
            "on the payoff plan."
        ),
    }
