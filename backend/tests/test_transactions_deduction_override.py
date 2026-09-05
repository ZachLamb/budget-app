"""Route test: transaction-level deduction_pct_override."""
from __future__ import annotations

import pytest

from tests.test_categories_routes import fixture, _seed_household, _seed_catalog, _client  # reuse fixtures
from app.models import Account, Transaction
import uuid
from datetime import date
from decimal import Decimal


@pytest.mark.asyncio
async def test_transaction_deduction_override_roundtrip(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    _, cat_a, _ = await _seed_catalog(session, hid)
    account = Account(id=str(uuid.uuid4()), household_id=hid, name="Checking", account_type="checking")
    session.add(account)
    await session.flush()
    txn = Transaction(id=str(uuid.uuid4()), account_id=account.id, date=date(2026, 1, 1), amount=Decimal("50.00"), category_id=cat_a.id)
    session.add(txn)
    await session.commit()

    async with _client() as client:
        resp = await client.put(
            f"/api/transactions/{txn.id}",
            headers=headers,
            json={"deduction_pct_override": 50},
        )
        assert resp.status_code == 200
        assert float(resp.json()["deduction_pct_override"]) == 50.0


@pytest.mark.asyncio
async def test_transaction_deduction_override_range_validated(fixture):
    session, _ = fixture
    hid, headers = await _seed_household(session)
    _, cat_a, _ = await _seed_catalog(session, hid)
    account = Account(id=str(uuid.uuid4()), household_id=hid, name="Checking", account_type="checking")
    session.add(account)
    await session.flush()
    txn = Transaction(id=str(uuid.uuid4()), account_id=account.id, date=date(2026, 1, 1), amount=Decimal("50.00"), category_id=cat_a.id)
    session.add(txn)
    await session.commit()

    async with _client() as client:
        for bad in (150, -5):
            resp = await client.put(
                f"/api/transactions/{txn.id}",
                headers=headers,
                json={"deduction_pct_override": bad},
            )
            assert resp.status_code == 422, f"expected 422 for deduction_pct_override={bad}"
