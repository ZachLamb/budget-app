from fastapi import APIRouter, Depends, Query

from app.api.deps import get_household_id
from app.schemas.subscriptions import CancelGuideResponse
from app.services.cancel_guides import (
    GENERIC_STEPS,
    find_cancel_guide,
    show_verified_link_badge,
)

router = APIRouter()


@router.get("/cancel-guide", response_model=CancelGuideResponse)
async def get_cancel_guide(
    payee_name: str = Query(..., min_length=1, max_length=300),
    household_id: str = Depends(get_household_id),
):
    """Look up curated cancellation steps by payee / merchant name (best-effort fuzzy match)."""
    _ = household_id  # auth gate only; guides are not household-specific
    m = find_cancel_guide(payee_name)
    if not m.matched:
        return CancelGuideResponse(
            matched=False,
            steps=[],
            generic_steps=list(GENERIC_STEPS),
            disclaimer="No curated guide matched this name. Use generic steps and confirm on the merchant’s site.",
        )

    link_ok = show_verified_link_badge(m.verification)
    disclaimer = None
    if m.verification == "community":
        disclaimer = "This entry is community-sourced. Confirm all links and steps on the merchant’s official site."
    elif m.verification == "maintainer_curated":
        disclaimer = "Links and steps are curated for convenience; merchants change flows—verify on the official site."

    return CancelGuideResponse(
        matched=True,
        merchant_key=m.merchant_key,
        display_name=m.display_name,
        verified_cancel_url=m.verified_cancel_url,
        steps=list(m.steps or []),
        verification=m.verification,
        link_is_verified=link_ok and bool(m.verified_cancel_url),
        generic_steps=list(GENERIC_STEPS),
        disclaimer=disclaimer,
    )
