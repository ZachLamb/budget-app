"""Resend transactional-email client.

The magic-link flow always returns 200 to the caller (anti-enumeration), so this
client's result is only ever used for logging. That makes accuracy cheap but not
worthless: reporting a delivered email as failed sends operators hunting a
non-existent outage.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.email import resend


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """Give the client the settings it refuses to send without."""

    class _Settings:
        resend_api_key = "re_test_key"
        email_from_address = "noreply@example.test"

    monkeypatch.setattr(resend, "get_settings", lambda: _Settings())


def _stub_transport(monkeypatch, handler) -> None:
    """Route the client's POST through an in-process handler."""
    transport = httpx.MockTransport(handler)
    original = httpx.AsyncClient

    def _client(*args, **kwargs):
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(resend.httpx, "AsyncClient", _client)


async def _send() -> resend.EmailSendResult:
    return await resend.send_email(to="user@example.test", subject="s", text="t")


@pytest.mark.asyncio
async def test_returns_provider_id_from_a_json_body(monkeypatch) -> None:
    _stub_transport(
        monkeypatch, lambda _req: httpx.Response(200, json={"id": "msg-abc123"})
    )

    result = await _send()

    assert result.ok is True
    assert result.provider_id == "msg-abc123"


@pytest.mark.asyncio
async def test_unparseable_success_body_still_counts_as_sent(monkeypatch) -> None:
    """A 2xx with a non-JSON body means the email WAS accepted.

    Previously this raised inside the client and was swallowed by the broad
    handler, reporting ok=False for a message Resend had already queued.
    """
    _stub_transport(monkeypatch, lambda _req: httpx.Response(200, text="OK"))

    result = await _send()

    assert result.ok is True
    assert result.provider_id is None


@pytest.mark.asyncio
async def test_empty_success_body_counts_as_sent(monkeypatch) -> None:
    _stub_transport(monkeypatch, lambda _req: httpx.Response(202, content=b""))

    result = await _send()

    assert result.ok is True
    assert result.provider_id is None


@pytest.mark.asyncio
async def test_error_status_is_a_failure_without_leaking_the_body(monkeypatch) -> None:
    _stub_transport(
        monkeypatch,
        lambda _req: httpx.Response(422, json={"message": "user@example.test invalid"}),
    )

    result = await _send()

    assert result.ok is False
    assert result.error == "HTTP 422"
    # The recipient is PII and must never ride along in the error string.
    assert "user@example.test" not in (result.error or "")


@pytest.mark.asyncio
async def test_unreachable_provider_is_a_failure(monkeypatch) -> None:
    def _boom(_req):
        raise httpx.ConnectError("no route to host")

    _stub_transport(monkeypatch, _boom)

    result = await _send()

    assert result.ok is False
    assert result.error == "Resend unreachable"


@pytest.mark.asyncio
async def test_missing_api_key_short_circuits(monkeypatch) -> None:
    class _Settings:
        resend_api_key = ""
        email_from_address = "noreply@example.test"

    monkeypatch.setattr(resend, "get_settings", lambda: _Settings())

    result = await _send()

    assert result.ok is False
    assert "RESEND_API_KEY" in (result.error or "")
