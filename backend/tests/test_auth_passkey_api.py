"""
API-level tests for passkey (WebAuthn) endpoints.

These require a running database. Run with:
  pytest backend/tests/test_auth_passkey_api.py -v

To skip when DB is not available, set RUN_PASSKEY_API_TESTS=0 or omit RUN_PASSKEY_API_TESTS.
"""
from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _should_run_passkey_api_tests() -> bool:
    return os.environ.get("RUN_PASSKEY_API_TESTS", "0") == "1"


@pytest.mark.skipif(
    not _should_run_passkey_api_tests(),
    reason="Set RUN_PASSKEY_API_TESTS=1 to run (requires DB)",
)
@pytest.mark.asyncio
async def test_passkey_authenticate_options_returns_200_and_options() -> None:
    """POST /api/auth/passkey/authenticate/options with no email returns options (discoverable key)."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        r = await client.post("/api/auth/passkey/authenticate/options", json={})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "options" in data
    assert isinstance(data["options"], str)
    # Options should contain challenge when parsed
    import json
    opts = json.loads(data["options"])
    pk = opts.get("publicKey", opts)
    assert "challenge" in pk
