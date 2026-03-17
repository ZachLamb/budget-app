from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass
class SyncedAccount:
    provider_id: str
    name: str
    institution: str
    account_type: str
    balance: Decimal
    currency: str = "USD"
    available_balance: Optional[Decimal] = None


@dataclass
class SyncedTransaction:
    provider_id: str
    date: date
    payee_name: str
    amount: Decimal
    memo: Optional[str] = None


@dataclass
class SyncResult:
    accounts: list[SyncedAccount]
    transactions: dict[str, list[SyncedTransaction]]  # keyed by provider account id


class SyncProvider(ABC):
    """Abstract base for bank sync providers (SimpleFIN, Plaid, etc.)."""

    @abstractmethod
    async def fetch_accounts(self) -> list[SyncedAccount]:
        ...

    @abstractmethod
    async def fetch_transactions(
        self, account_ids: list[str], start_date: date, end_date: date
    ) -> dict[str, list[SyncedTransaction]]:
        ...

    async def sync_all(self, start_date: date, end_date: date) -> SyncResult:
        accounts = await self.fetch_accounts()
        account_ids = [a.provider_id for a in accounts]
        transactions = await self.fetch_transactions(account_ids, start_date, end_date)
        return SyncResult(accounts=accounts, transactions=transactions)
