from __future__ import annotations

import base64
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.services.sync.base import SyncProvider, SyncedAccount, SyncedTransaction
from app.services.sync.simplefin_hosts import validate_simplefin_url

logger = logging.getLogger(__name__)


def _parse_access_url(access_url: str) -> tuple[str, str, str]:
    """Parse SimpleFIN access URL (https://user:pass@host/path) into base_url, username, password."""
    parsed = urlparse(access_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Invalid SimpleFIN access URL format")
    username = parsed.username or ""
    password = parsed.password or ""
    # Build base URL without credentials (host + path only for requests)
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    path = (parsed.path or "").rstrip("/")
    base_url = f"{parsed.scheme}://{host}{port}{path}"
    return base_url, username, password


class SimpleFINProvider(SyncProvider):
    """SimpleFIN Bridge sync provider.

    Requires an access URL or base64 setup token from https://beta-bridge.simplefin.org/
    """

    def __init__(self, access_url: str):
        self.access_url = access_url.strip()
        self._base_url: Optional[str] = None
        self._auth: Optional[tuple[str, str]] = None

    @property
    def resolved_access_url(self) -> str | None:
        """Return the fully-resolved access URL (with credentials) after connecting, or None if not yet connected."""
        if self._base_url and self._auth:
            user, pwd = self._auth
            return self._base_url.replace("://", f"://{user}:{pwd}@", 1)
        return None

    async def _ensure_connected(self):
        if self._base_url:
            return

        claim_or_access_url = self.access_url
        # If it doesn't look like a URL, treat as base64-encoded setup token (decodes to claim URL)
        if not claim_or_access_url.startswith("http://") and not claim_or_access_url.startswith("https://"):
            normalized = claim_or_access_url.replace("-", "+").replace("_", "/")
            padded = normalized + "=" * (4 - len(normalized) % 4)
            try:
                raw = base64.b64decode(padded)
            except Exception as e:
                raise ValueError(f"SIMPLEFIN_ACCESS_URL: invalid base64 setup token: {e}") from e
            claim_or_access_url = raw.decode("utf-8").strip()
            logger.info("SimpleFIN: decoded setup token to claim URL (host=%s)", urlparse(claim_or_access_url).netloc)

        # Detect if this is already an access URL (has embedded credentials: https://user:pass@host/...)
        parsed_check = urlparse(claim_or_access_url)
        is_access_url = bool(parsed_check.username)  # credentials present → already claimed

        if is_access_url:
            validate_simplefin_url(claim_or_access_url, context="SimpleFIN access URL")
            self._base_url, username, password = _parse_access_url(claim_or_access_url)
            self._auth = (username, password)
        else:
            validate_simplefin_url(claim_or_access_url, context="SimpleFIN claim URL")
            # Claim the setup token: POST to claim URL with Content-Length: 0 (per SimpleFIN spec)
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
                response = await client.post(
                    claim_or_access_url,
                    content=b"",
                    headers={"Content-Length": "0"},
                )
                if response.status_code != 200:
                    raise ValueError(
                        f"SimpleFIN claim failed (HTTP {response.status_code}): {response.text[:500]}"
                    )
                claimed_url = response.text.strip()
            validate_simplefin_url(claimed_url, context="SimpleFIN claimed access URL")
            parsed_claimed = urlparse(claimed_url)
            if not parsed_claimed.scheme or not parsed_claimed.username:
                raise ValueError(
                    f"SimpleFIN returned invalid access URL (expected https://user:pass@host/...): {claimed_url[:120]}"
                )
            self._base_url, username, password = _parse_access_url(claimed_url)
            self._auth = (username, password)
            logger.info("SimpleFIN: claimed setup token successfully")

    async def fetch_accounts(self) -> list[SyncedAccount]:
        await self._ensure_connected()
        async with httpx.AsyncClient(auth=self._auth, timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            resp = await client.get(f"{self._base_url}/accounts")
            if resp.status_code == 403:
                raise ValueError("SimpleFIN connection expired or revoked. Please reconnect in Settings → SimpleFIN Bank Connection.")
            resp.raise_for_status()
            data = resp.json()

        errors = data.get("errors", [])
        if errors:
            logger.warning("SimpleFIN /accounts returned errors: %s", errors)

        raw_accounts = data.get("accounts", [])
        if not raw_accounts:
            logger.warning(
                "SimpleFIN /accounts returned 0 accounts. "
                "If using a demo token, connect a bank at https://beta-bridge.simplefin.org/ to get data."
            )

        _CREDIT_PATTERNS = (
            "credit", "visa", "mastercard", "master card", "amex",
            "american express", "discover", "sapphire", "freedom",
            "quicksilver", "venture", "platinum card", "gold card",
            "blue card", "southwest", "united card", "delta card",
        )
        _LOAN_PATTERNS = (
            "loan", "mortgage", "auto loan", "student loan",
            "home equity", "heloc", "line of credit",
        )

        accounts = []
        for acct in raw_accounts:
            account_type = "checking"
            name_lower = acct.get("name", "").lower()
            if any(p in name_lower for p in _CREDIT_PATTERNS):
                account_type = "credit"
            elif any(p in name_lower for p in _LOAN_PATTERNS):
                account_type = "loan"
            elif "saving" in name_lower:
                account_type = "savings"
            elif "invest" in name_lower or "brokerage" in name_lower:
                account_type = "investment"

            avail = acct.get("available-balance")
            available_balance = Decimal(str(avail)) if avail is not None else None

            accounts.append(SyncedAccount(
                provider_id=acct["id"],
                name=acct.get("name", "Unknown Account"),
                institution=acct.get("org", {}).get("name", "Unknown"),
                account_type=account_type,
                balance=Decimal(str(acct.get("balance", "0"))),
                currency=acct.get("currency", "USD"),
                available_balance=available_balance,
            ))
        return accounts

    async def fetch_transactions(
        self, account_ids: list[str], start_date: date, end_date: date
    ) -> dict[str, list[SyncedTransaction]]:
        await self._ensure_connected()
        start_ts = int(datetime.combine(start_date, datetime.min.time()).timestamp())
        end_ts = int(datetime.combine(end_date, datetime.max.time()).timestamp())

        async with httpx.AsyncClient(auth=self._auth, timeout=httpx.Timeout(60.0, connect=5.0)) as client:
            resp = await client.get(
                f"{self._base_url}/accounts",
                params={"start-date": start_ts, "end-date": end_ts},
            )
            if resp.status_code == 403:
                raise ValueError("SimpleFIN connection expired or revoked. Please reconnect in Settings → SimpleFIN Bank Connection.")
            resp.raise_for_status()
            data = resp.json()

        result: dict[str, list[SyncedTransaction]] = {aid: [] for aid in account_ids}
        for acct in data.get("accounts", []):
            acct_id = acct["id"]
            if acct_id not in account_ids:
                continue
            txns = []
            for t in acct.get("transactions", []):
                txn_id = t.get("id", "")
                if not txn_id:
                    logger.warning("SimpleFIN: skipping transaction with no id (acct=%s)", acct_id)
                    continue
                posted = t.get("posted")
                txn_date = date.fromtimestamp(posted) if posted else date.today()
                txns.append(SyncedTransaction(
                    provider_id=txn_id,
                    date=txn_date,
                    payee_name=t.get("payee", t.get("description", "Unknown")),
                    amount=Decimal(str(t.get("amount", "0"))),
                    memo=t.get("memo"),
                ))
            result[acct_id] = txns
        return result
