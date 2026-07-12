from __future__ import annotations

"""Per-household asyncio queue registry for SSE realtime events.

Design: one asyncio.Queue per active SSE subscriber. Write routes call
emit_event() to fan out a lightweight change notification. Clients refetch
the affected resource on receipt — no full payload in the SSE frame.

No persistence: events emitted while no subscriber is connected are dropped.
This is intentional — SSE is for live UI updates, not reliable delivery.
Use the standard REST endpoints for initial data load.
"""

import asyncio
import json
import logging
from collections import defaultdict
from typing import AsyncIterator

logger = logging.getLogger(__name__)

# household_id → set of subscriber queues
_subscribers: dict[str, set[asyncio.Queue[str | None]]] = defaultdict(set)


async def subscribe(household_id: str) -> AsyncIterator[str]:
    """Async generator: yields SSE-formatted strings until the client disconnects."""
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=50)
    _subscribers[household_id].add(queue)
    logger.debug("realtime_subscribe household=%s total=%d", household_id, len(_subscribers[household_id]))
    try:
        yield ": connected\n\n"  # SSE comment keeps the connection alive
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=25.0)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if message is None:
                break
            yield message
    finally:
        _subscribers[household_id].discard(queue)
        if not _subscribers[household_id]:
            del _subscribers[household_id]
        logger.debug("realtime_unsubscribe household=%s", household_id)


async def emit_event(household_id: str, event_type: str) -> None:
    """Broadcast a change event to all active subscribers for this household."""
    subs = _subscribers.get(household_id)
    if not subs:
        return
    payload = json.dumps({"type": event_type, "household_id": household_id})
    message = f"data: {payload}\n\n"
    for queue in list(subs):
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning("realtime_queue_full household=%s dropping event=%s", household_id, event_type)
