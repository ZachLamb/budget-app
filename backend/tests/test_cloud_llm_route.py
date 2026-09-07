"""Opt-in Tier 4 cloud generate route."""

from __future__ import annotations

import asyncio
import contextlib
from typing import AsyncIterator, Optional

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


class _User:
    id = "user-test"
    household_id = None


@contextlib.contextmanager
def _overrides():
    """Auth + DB overrides so the route runs without a real user or database."""
    from app.api.deps import get_current_user
    from app.database import get_db

    async def _user() -> _User:
        return _User()

    async def _db():
        yield None

    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_db] = _db
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_cloud_generate_unconfigured_returns_503(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.llm.llm_client.is_configured", lambda: False)

    with _overrides():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={
                    "feature": "free_form_qa",
                    "prompt": "hello",
                    "system": "test",
                    "max_tokens": 64,
                },
            )
        assert resp.status_code == 503


def _allow_everything(monkeypatch) -> None:
    """Configured backend + active consent, so the route reaches the generator."""
    monkeypatch.setattr("app.api.routes.llm.llm_client.is_configured", lambda: True)

    async def _has_consent(*_args, **_kwargs) -> bool:
        return True

    monkeypatch.setattr(
        "app.api.routes.llm.consent_service.has_active_consent", _has_consent
    )


class _AuditSpy:
    """Capture what the route would have written to the audit log."""

    def __init__(self) -> None:
        self.rows: list[dict] = []

    def install(self, monkeypatch) -> None:
        async def _write(**kwargs) -> None:
            self.rows.append(kwargs)

        monkeypatch.setattr("app.api.routes.llm._write_stream_audit", _write)


@pytest.mark.asyncio
async def test_prompt_is_structurally_sanitized(monkeypatch) -> None:
    """Control characters and delimiters in the prompt never reach the model.

    The prompt is assembled client-side from user-authored text (payee names,
    memos), so it gets the same structural cleaning as the system prompt.
    """
    _allow_everything(monkeypatch)
    seen: dict[str, Optional[str]] = {}

    async def _stream(prompt: str, system: Optional[str], **_kw) -> AsyncIterator[str]:
        seen["prompt"] = prompt
        seen["system"] = system
        yield '{"answer":"ok"}'

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    _AuditSpy().install(monkeypatch)

    with _overrides():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={
                    "feature": "free_form_qa",
                    "prompt": "Explain\x00 this\nrow | `code` ---- now",
                    "max_tokens": 64,
                },
            )

    assert resp.status_code == 200
    sent = seen["prompt"]
    assert sent is not None
    assert "\x00" not in sent
    assert "\n" not in sent
    assert "|" not in sent
    assert "`" not in sent
    assert "----" not in sent
    assert "Explain" in sent


@pytest.mark.asyncio
async def test_prompt_that_is_only_junk_is_rejected(monkeypatch) -> None:
    """A prompt that sanitizes down to nothing is a 422, not an empty model call."""
    _allow_everything(monkeypatch)

    called = False

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        nonlocal called
        called = True
        yield "unreachable"

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)

    with _overrides():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={"feature": "free_form_qa", "prompt": "\x00\x01 \t ", "max_tokens": 64},
            )

    assert resp.status_code == 422
    assert not called


@pytest.mark.asyncio
async def test_audit_row_written_for_a_successful_stream(monkeypatch) -> None:
    _allow_everything(monkeypatch)

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        yield '{"answer":'
        yield '"ok"}'

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    spy = _AuditSpy()
    spy.install(monkeypatch)

    with _overrides():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={"feature": "free_form_qa", "prompt": "hello", "max_tokens": 64},
            )

    assert resp.status_code == 200
    assert len(spy.rows) == 1
    assert spy.rows[0]["status_code"] == 200
    assert spy.rows[0]["feature"] == "free_form_qa"
    assert spy.rows[0]["completion"] == '{"answer":"ok"}'


@pytest.mark.asyncio
async def test_audit_row_written_when_upstream_stream_fails(monkeypatch) -> None:
    _allow_everything(monkeypatch)
    from app.services.ai import llm_client

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        yield "partial"
        raise llm_client.LlmStreamError("upstream died")

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    spy = _AuditSpy()
    spy.install(monkeypatch)

    with _overrides():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={"feature": "free_form_qa", "prompt": "hello", "max_tokens": 64},
            )

    # Header is already sent, so the failure is reported in-band as an SSE frame.
    assert resp.status_code == 200
    assert '"error"' in resp.text
    assert len(spy.rows) == 1
    assert spy.rows[0]["status_code"] == 502


@pytest.mark.asyncio
async def test_audit_row_written_when_the_client_disconnects(monkeypatch) -> None:
    """The audit write is shielded, so a cancelled stream is still recorded.

    Without the shield, closing the generator cancels the task at its first
    await and the row is silently lost — for exactly the requests we most want
    in the log, since the model server kept working on them.
    """
    _allow_everything(monkeypatch)

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        yield "first chunk"
        # Client goes away while we're waiting on the model.
        await asyncio.sleep(3600)
        yield "never"

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    spy = _AuditSpy()
    spy.install(monkeypatch)

    from app.api.routes.llm import CloudGenerateRequest, cloud_generate

    with _overrides():
        response = await cloud_generate(
            CloudGenerateRequest(feature="free_form_qa", prompt="hello", max_tokens=64),
            user=_User(),  # type: ignore[arg-type]
            db=None,  # type: ignore[arg-type]
        )
        agen = response.body_iterator
        assert b"first chunk" in await agen.__anext__()
        # Simulate the disconnect: Starlette closes the generator.
        await agen.aclose()

    assert len(spy.rows) == 1
    assert spy.rows[0]["status_code"] == 499
    assert spy.rows[0]["completion"] == "first chunk"


@pytest.mark.asyncio
async def test_disconnect_audit_survives_a_suspending_write(monkeypatch) -> None:
    """The write completes even though it suspends during generator cleanup.

    A real audit write does a DB round-trip, so it yields to the loop while the
    generator is being closed. Guards against both losing the row and raising
    "async generator ignored GeneratorExit".
    """
    _allow_everything(monkeypatch)
    written: list[int] = []

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        yield "chunk"
        await asyncio.sleep(3600)

    async def _slow_write(**kwargs) -> None:
        await asyncio.sleep(0)  # a real round-trip suspends here
        written.append(kwargs["status_code"])

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    monkeypatch.setattr("app.api.routes.llm._write_stream_audit", _slow_write)

    from app.api.routes.llm import CloudGenerateRequest, cloud_generate

    with _overrides():
        response = await cloud_generate(
            CloudGenerateRequest(feature="free_form_qa", prompt="hello", max_tokens=64),
            user=_User(),  # type: ignore[arg-type]
            db=None,  # type: ignore[arg-type]
        )
        agen = response.body_iterator
        await agen.__anext__()
        await agen.aclose()

    assert written == [499]


@pytest.mark.asyncio
async def test_audit_survives_request_task_cancellation(monkeypatch) -> None:
    """A request cancelled mid-stream is still recorded, tagged 499.

    The cancellation path reaches the generator as CancelledError rather than
    GeneratorExit, and neither is an `Exception` — before this was handled, the
    status fell through as 200 and a cancelled request looked like a clean one.
    """
    _allow_everything(monkeypatch)
    written: list[int] = []

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        yield "chunk"
        await asyncio.sleep(3600)

    async def _slow_write(**kwargs) -> None:
        await asyncio.sleep(0)
        written.append(kwargs["status_code"])

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    monkeypatch.setattr("app.api.routes.llm._write_stream_audit", _slow_write)

    from app.api.routes.llm import CloudGenerateRequest, cloud_generate

    with _overrides():
        response = await cloud_generate(
            CloudGenerateRequest(feature="free_form_qa", prompt="hello", max_tokens=64),
            user=_User(),  # type: ignore[arg-type]
            db=None,  # type: ignore[arg-type]
        )
        agen = response.body_iterator

        async def drain() -> None:
            async for _ in agen:
                pass

        task = asyncio.create_task(drain())
        await asyncio.sleep(0.01)  # let it emit the first chunk and block
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        # Give the shielded write its turn now that the consumer is gone.
        await asyncio.sleep(0.01)

    assert written == [499]


@pytest.mark.asyncio
async def test_audit_write_failure_does_not_break_the_response(monkeypatch) -> None:
    """A broken audit log must never surface as an error for the user."""
    _allow_everything(monkeypatch)

    async def _stream(*_a, **_kw) -> AsyncIterator[str]:
        yield '{"answer":"ok"}'

    async def _boom(*_args, **_kwargs) -> None:
        raise RuntimeError("audit table is gone")

    monkeypatch.setattr("app.api.routes.llm.llm_client.stream_complete", _stream)
    monkeypatch.setattr("app.api.routes.llm.audit.write", _boom)

    with _overrides():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/llm/cloud",
                json={"feature": "free_form_qa", "prompt": "hello", "max_tokens": 64},
            )

    assert resp.status_code == 200
    # The completion still reaches the client (JSON-escaped inside the SSE frame).
    assert "answer" in resp.text
    assert '"done":true' in resp.text
    assert '"error"' not in resp.text
