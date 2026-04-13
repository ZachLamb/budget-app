"""Per-household AI rate limiter (sliding window)."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.services.ai import household_rate_limit as hrl


@pytest.mark.asyncio
async def test_enforce_allows_under_cap() -> None:
    hid = str(uuid.uuid4())
    await hrl.enforce_household_ai_rate_limit(hid, 5)
    await hrl.enforce_household_ai_rate_limit(hid, 5)


@pytest.mark.asyncio
async def test_enforce_blocks_over_cap() -> None:
    hid = str(uuid.uuid4())
    await hrl.enforce_household_ai_rate_limit(hid, 2)
    await hrl.enforce_household_ai_rate_limit(hid, 2)
    with pytest.raises(HTTPException) as ei:
        await hrl.enforce_household_ai_rate_limit(hid, 2)
    assert ei.value.status_code == 429


@pytest.mark.asyncio
async def test_enforce_disabled_when_zero() -> None:
    hid = str(uuid.uuid4())
    for _ in range(5):
        await hrl.enforce_household_ai_rate_limit(hid, 0)
