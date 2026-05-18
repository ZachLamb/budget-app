"""Categorization candidates (data-only)."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_fetch_categorize_candidates_empty() -> None:
    from app.services.categorization.candidates import fetch_categorize_candidates

    class _FakeScalars:
        def all(self):
            return []

    class _FakeResult:
        def scalars(self):
            return _FakeScalars()

    class _FakeDb:
        async def execute(self, *_args, **_kwargs):
            return _FakeResult()

    out = await fetch_categorize_candidates(_FakeDb(), "hh-1")
    assert out["transactions"] == []
    assert out["categories"] == []
