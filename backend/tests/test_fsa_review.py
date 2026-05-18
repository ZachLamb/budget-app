"""FSA review service and route gating."""

from __future__ import annotations

import pytest

from app.services.ai import consent as consent_service


def test_fsa_review_is_known_consent_feature() -> None:
    assert consent_service.is_known_feature("fsa_review")


@pytest.mark.asyncio
async def test_run_fsa_review_demo_mode_empty_candidates(monkeypatch) -> None:
    """Demo canned JSON must match the parser shape (eligible array)."""
    from app.services.ai import fsa as fsa_service

    monkeypatch.setenv("DEMO_MODE", "true")

    class _FakeResult:
        def all(self):
            return []

    class _FakeDb:
        async def execute(self, *_args, **_kwargs):
            return _FakeResult()

    out = await fsa_service.run_fsa_review(_FakeDb(), "hh-1", None, None)
    assert out["eligible_transactions"] == []
    assert out["model_source"] == "none"
