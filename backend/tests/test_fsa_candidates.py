"""FSA candidates (data-only, no LLM)."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_fetch_fsa_candidates_shape() -> None:
    from app.services.ai import fsa as fsa_service

    class _FakeResult:
        def all(self):
            return []

    class _FakeDb:
        async def execute(self, *_args, **_kwargs):
            return _FakeResult()

    out = await fsa_service.fetch_fsa_candidates(_FakeDb(), "hh-1", None, None)
    assert out["candidates"] == []
    assert out["scan_count"] == 0
    assert out["candidate_count"] == 0
    assert "_candidate_rows" in out
