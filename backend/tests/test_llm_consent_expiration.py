"""Unit tests for ``is_within_renewal_window`` — the helper that powers the
'Renew' button in the AI settings UI. No DB needed; the function is pure
math on an ``LlmConsent`` instance.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.llm import LlmConsent
from app.services.ai import consent as consent_service


def _make_grant(*, expires_in: timedelta | None, revoked: bool = False) -> LlmConsent:
    """Build a transient (un-persisted) LlmConsent for pure-function tests."""
    now = datetime.now(timezone.utc)
    return LlmConsent(
        user_id="u1",
        feature="explain_charge",
        tier=4,
        granted_at=now,
        revoked_at=now if revoked else None,
        expires_at=(now + expires_in) if expires_in is not None else None,
    )


def test_is_within_renewal_window_true_when_6_days_left():
    grant = _make_grant(expires_in=timedelta(days=6))
    assert consent_service.is_within_renewal_window(grant) is True


def test_is_within_renewal_window_false_when_30_days_left():
    grant = _make_grant(expires_in=timedelta(days=30))
    assert consent_service.is_within_renewal_window(grant) is False


def test_is_within_renewal_window_false_when_already_expired():
    """An already-expired grant is NOT in the renewal window — its UI
    affordance is "Re-grant," not "Renew." The renewal window only fires
    when the grant is still active but about to roll over."""
    grant = _make_grant(expires_in=timedelta(days=-1))
    assert consent_service.is_within_renewal_window(grant) is False


def test_is_within_renewal_window_false_when_revoked():
    """A revoked grant is never in the renewal window."""
    grant = _make_grant(expires_in=timedelta(days=3), revoked=True)
    assert consent_service.is_within_renewal_window(grant) is False


def test_is_within_renewal_window_false_when_no_expiry():
    """A grant with NULL expires_at (legacy row) is never in the renewal window."""
    grant = _make_grant(expires_in=None)
    assert consent_service.is_within_renewal_window(grant) is False


def test_is_within_renewal_window_respects_custom_days():
    """Caller can widen or narrow the window."""
    grant = _make_grant(expires_in=timedelta(days=14))
    # Default 7-day window: not in scope.
    assert consent_service.is_within_renewal_window(grant) is False
    # 30-day window: in scope.
    assert consent_service.is_within_renewal_window(grant, days=30) is True
