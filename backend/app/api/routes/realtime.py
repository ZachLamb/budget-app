from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, get_household_id
from app.models.user import User
from app.services.realtime import subscribe

router = APIRouter()


@router.get("/events")
async def realtime_events(
    household_id: str = Depends(get_household_id),
    _user: User = Depends(get_current_user),
):
    """SSE stream of lightweight change events for this household.

    Clients receive ``{"type": "transaction.created", "household_id": "..."}``
    and refetch the affected resource. No full payload is sent over SSE.

    The stream sends a keepalive comment every 25 seconds to prevent
    proxies from closing idle connections.
    """
    return StreamingResponse(
        subscribe(household_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
