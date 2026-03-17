from __future__ import annotations

import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Household, Account

logger = logging.getLogger(__name__)

router = APIRouter()


class SimplefinTokenUpdate(BaseModel):
    token: str


class SimplefinClaimRequest(BaseModel):
    token: str


class SimplefinClaimAccount(BaseModel):
    name: str
    account_type: str
    balance: str
    institution: str
    available_balance: Optional[str] = None


class SimplefinClaimResponse(BaseModel):
    accounts: list[SimplefinClaimAccount]
    institution_count: int


class SimplefinStatusResponse(BaseModel):
    configured: bool
    is_access_url: bool


@router.get("/simplefin", response_model=SimplefinStatusResponse)
async def get_simplefin_status(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Return whether SimpleFIN is configured for this household."""
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()

    url = household.simplefin_access_url if household else None
    if not url:
        return SimplefinStatusResponse(configured=False, is_access_url=False)

    is_access_url = "://" in url and "@" in url
    return SimplefinStatusResponse(configured=True, is_access_url=is_access_url)


@router.post("/simplefin/claim", response_model=SimplefinClaimResponse)
async def claim_simplefin_token(
    body: SimplefinClaimRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Claim a SimpleFIN setup token immediately and return discovered accounts.

    Decodes the base64 token, POSTs to the claim URL, saves the access URL,
    and fetches the account list for preview.
    """
    from app.services.sync.simplefin import SimpleFINProvider
    import httpx

    token = body.token.strip()
    if not token:
        raise HTTPException(400, "Token must not be empty")

    provider = SimpleFINProvider(token)
    try:
        accounts = await provider.fetch_accounts()
    except ValueError as e:
        msg = str(e)
        if "invalid base64" in msg.lower():
            raise HTTPException(422, f"Invalid token format: {msg}")
        if "claim failed" in msg.lower():
            status_code = 403 if "403" in msg else 502
            raise HTTPException(status_code, msg)
        raise HTTPException(400, msg)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(403, "Token already claimed or expired. Generate a new one from SimpleFIN Bridge.")
        raise HTTPException(502, f"SimpleFIN returned HTTP {e.response.status_code}")
    except httpx.ConnectError:
        raise HTTPException(502, "Could not connect to SimpleFIN Bridge. Check your network and try again.")
    except Exception as e:
        logger.exception("Unexpected error claiming SimpleFIN token")
        raise HTTPException(500, f"Unexpected error: {str(e)[:200]}")

    resolved_url = provider.resolved_access_url
    if not resolved_url:
        raise HTTPException(500, "Token was claimed but no access URL was returned")

    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")

    old_url = household.simplefin_access_url
    household.simplefin_access_url = resolved_url

    # If replacing an existing connection, unlink old accounts so they
    # become manual accounts. The next full sync will re-match them by
    # simplefin_id if the same bank is still connected.
    if old_url and old_url != resolved_url:
        old_accounts_result = await db.execute(
            select(Account).where(
                Account.household_id == household_id,
                Account.simplefin_id.isnot(None),
            )
        )
        unlinked = old_accounts_result.scalars().all()
        for acct in unlinked:
            acct.simplefin_id = None
        if unlinked:
            logger.info("Replaced SimpleFIN connection for household %s, unlinked %d accounts",
                         household_id, len(unlinked))

    await db.commit()

    institutions = set()
    claim_accounts = []
    for a in accounts:
        institutions.add(a.institution)
        avail = str(a.available_balance) if a.available_balance is not None else None
        claim_accounts.append(SimplefinClaimAccount(
            name=a.name,
            account_type=a.account_type,
            balance=str(a.balance),
            institution=a.institution,
            available_balance=avail,
        ))

    return SimplefinClaimResponse(
        accounts=claim_accounts,
        institution_count=len(institutions),
    )


class AiSettingsResponse(BaseModel):
    ai_enabled: bool


class AiSettingsUpdate(BaseModel):
    ai_enabled: bool


@router.get("/ai", response_model=AiSettingsResponse)
async def get_ai_settings(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Return AI settings for this household."""
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")
    return AiSettingsResponse(ai_enabled=bool(household.ai_enabled))


@router.put("/ai", response_model=AiSettingsResponse)
async def update_ai_settings(
    body: AiSettingsUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Update AI settings for this household."""
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")
    household.ai_enabled = body.ai_enabled
    await db.commit()
    return AiSettingsResponse(ai_enabled=bool(household.ai_enabled))


class PlanPreferencesResponse(BaseModel):
    debt_strategy: Optional[str]
    debt_extra_monthly: Optional[float]


class PlanPreferencesUpdate(BaseModel):
    debt_strategy: Optional[str] = None
    debt_extra_monthly: Optional[float] = None


_VALID_STRATEGIES = {"avalanche", "snowball"}


@router.get("/plan-preferences", response_model=PlanPreferencesResponse)
async def get_plan_preferences(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Return the household's saved debt plan preferences."""
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")
    return PlanPreferencesResponse(
        debt_strategy=household.debt_strategy,
        debt_extra_monthly=float(household.debt_extra_monthly) if household.debt_extra_monthly is not None else None,
    )


@router.put("/plan-preferences", response_model=PlanPreferencesResponse)
async def update_plan_preferences(
    body: PlanPreferencesUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Update the household's saved debt plan preferences."""
    if body.debt_strategy is not None and body.debt_strategy not in _VALID_STRATEGIES:
        raise HTTPException(400, f"debt_strategy must be one of: {', '.join(sorted(_VALID_STRATEGIES))}")
    if body.debt_extra_monthly is not None:
        if body.debt_extra_monthly < 0 or body.debt_extra_monthly > 1_000_000:
            raise HTTPException(400, "debt_extra_monthly must be between 0 and 1,000,000")

    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")

    # Use model_fields_set so sending null explicitly clears the value
    if "debt_strategy" in body.model_fields_set:
        household.debt_strategy = body.debt_strategy
    if "debt_extra_monthly" in body.model_fields_set:
        household.debt_extra_monthly = body.debt_extra_monthly

    return PlanPreferencesResponse(
        debt_strategy=household.debt_strategy,
        debt_extra_monthly=float(household.debt_extra_monthly) if household.debt_extra_monthly is not None else None,
    )


@router.post("/simplefin")
async def update_simplefin_token(
    body: SimplefinTokenUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Set or replace the SimpleFIN setup token / access URL (legacy endpoint)."""
    token = body.token.strip()
    if not token:
        raise HTTPException(400, "Token must not be empty")

    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")

    household.simplefin_access_url = token
    await db.commit()
    return {"ok": True}
