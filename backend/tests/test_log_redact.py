"""Tests for the log-redaction utility used by the cloud LLM route.

Critical privacy invariant: prompt text, tokens, SSNs, credit cards, and
email addresses must not survive a round trip through ``safe_error_message``.
"""
from __future__ import annotations

import pytest

from app.services.ai.log_redact import _MAX_LEN, redact, safe_error_message


class _FakeUpstreamError(Exception):
    """Stand-in for an httpx error whose __str__ includes the request body."""


@pytest.mark.parametrize(
    "raw, must_not_contain",
    [
        ('Request body: {"prompt":"my SSN is 123-45-6789","feature":"explain_charge"}',
         ["my SSN is", "123-45-6789"]),
        ('Failed to forward {"system":"You are a bank","message":"4111 1111 1111 1111"}',
         ["You are a bank", "4111"]),
        ("Auth header was Bearer abc123def456ghi789",
         ["abc123def456ghi789"]),
        ("user@example.com triggered an error",
         ["user@example.com"]),
        ('{"notes":"weekly groceries at Trader Joe\'s"}',
         ["groceries", "Trader"]),
    ],
)
def test_safe_error_message_redacts_known_patterns(raw, must_not_contain):
    err = _FakeUpstreamError(raw)
    out = safe_error_message(err)
    for needle in must_not_contain:
        assert needle not in out, f"expected {needle!r} to be redacted; got {out!r}"
    # Exception class name should still be present so operators can grep failure type.
    assert "_FakeUpstreamError" in out


def test_safe_error_message_truncates_long_inputs():
    big = "x" * (_MAX_LEN * 3)
    out = safe_error_message(_FakeUpstreamError(big))
    assert len(out) <= _MAX_LEN + 100  # plus prefix/class-name slack
    assert out.endswith("...")


def test_safe_error_message_handles_empty_repr():
    out = safe_error_message(_FakeUpstreamError(""))
    assert "_FakeUpstreamError" in out
    # No SSN/CC/email patterns survived.
    assert "redacted" not in out  # nothing to redact, no token emitted


def test_safe_error_message_includes_prefix():
    out = safe_error_message(_FakeUpstreamError("oops"), prefix="cloud stream")
    assert out.startswith("cloud stream:")


def test_redact_plain_string():
    s = redact('contact: alice@example.com SSN 123-45-6789')
    assert "alice@example.com" not in s
    assert "123-45-6789" not in s
    assert "[redacted-email]" in s
    assert "[redacted-ssn]" in s


def test_redact_does_not_eat_normal_text():
    s = redact("rate limit exceeded after 50 requests")
    assert s == "rate limit exceeded after 50 requests"
