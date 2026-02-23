import base64
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

import httpx

from app.services.sync.base import SyncProvider, SyncedAccount, SyncedTransaction


class SimpleFINProvider(SyncProvider):
    """SimpleFIN Bridge sync provider.

    Requires an access URL obtained from https://beta-bridge.simplefin.org/
    The access URL is exchanged for an access token on first use.
    """

    def __init__(self, access_url: str):
        self.access_url = access_url
        self._base_url: Optional[str] = None
        self._auth: Optional[tuple[str, str]] = None

    async def _ensure_connected(self):
        if self._base_url:
            return

        if "/access/" in self.access_url:
            # Already claimed -- extract base URL and credentials
            parts = self.access_url.split("//")
            scheme = parts[0]
            rest = parts[1]
            creds, host_path = rest.split("@", 1)
            username, password = creds.split(":", 1)
            self._base_url = f"{scheme}//{host_path}"
            self._auth = (username, password)
        else:
            # Claim the setup token to get an access URL
            async with httpx.AsyncClient() as client:
                response = await client.post(self.access_url)
                response.raise_for_status()
                claimed_url = response.text.strip()
                parts = claimed_url.split("//")
                scheme = parts[0]
                rest = parts[1]
                creds, host_path = rest.split("@", 1)
                username, password = creds.split(":", 1)
                self._base_url = f"{scheme}//{host_path}"
                self._auth = (username, password)

    async def fetch_accounts(self) -> list[SyncedAccount]:
        await self._ensure_connected()
        async with httpx.AsyncClient(auth=self._auth) as client:
            resp = await client.get(f"{self._base_url}/accounts")
            resp.raise_for_status()
            data = resp.json()

        accounts = []
        for acct in data.get("accounts", []):
            account_type = "checking"
            name_lower = acct.get("name", "").lower()
            if "credit" in name_lower:
                account_type = "credit"
            elif "saving" in name_lower:
                account_type = "savings"
            elif "invest" in name_lower or "brokerage" in name_lower:
                account_type = "investment"

            accounts.append(SyncedAccount(
                provider_id=acct["id"],
                name=acct.get("name", "Unknown Account"),
                institution=acct.get("org", {}).get("name", "Unknown"),
                account_type=account_type,
                balance=Decimal(str(acct.get("balance", "0"))),
                currency=acct.get("currency", "USD"),
            ))
        return accounts

    async def fetch_transactions(
        self, account_ids: list[str], start_date: date, end_date: date
    ) -> dict[str, list[SyncedTransaction]]:
        await self._ensure_connected()
        start_ts = int(datetime.combine(start_date, datetime.min.time()).timestamp())
        end_ts = int(datetime.combine(end_date, datetime.max.time()).timestamp())

        async with httpx.AsyncClient(auth=self._auth) as client:
            resp = await client.get(
                f"{self._base_url}/accounts",
                params={"start-date": start_ts, "end-date": end_ts},
            )
            resp.raise_for_status()
            data = resp.json()

        result: dict[str, list[SyncedTransaction]] = {}
        for acct in data.get("accounts", []):
            acct_id = acct["id"]
            if acct_id not in account_ids:
                continue
            txns = []
            for t in acct.get("transactions", []):
                posted = t.get("posted")
                txn_date = date.fromtimestamp(posted) if posted else date.today()
                txns.append(SyncedTransaction(
                    provider_id=t.get("id", ""),
                    date=txn_date,
                    payee_name=t.get("payee", t.get("description", "Unknown")),
                    amount=Decimal(str(t.get("amount", "0"))),
                    memo=t.get("memo"),
                ))
            result[acct_id] = txns
        return result
