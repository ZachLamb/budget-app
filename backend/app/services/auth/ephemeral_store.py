"""Shared ephemeral key-value storage for OAuth codes and WebAuthn challenges.

Uses the same Upstash REST credentials as rate limiting when configured;
falls back to an in-process dict for dev/single-worker.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional, Protocol

import httpx

logger = logging.getLogger(__name__)

_KEY_PREFIX = "ephemeral:"


class EphemeralStore(Protocol):
    @property
    def backend_name(self) -> str:
        ...

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        ...

    async def get(self, key: str) -> Optional[str]:
        ...

    async def get_del(self, key: str) -> Optional[str]:
        """Atomically read and delete. Used for single-use OAuth codes."""
        ...


def _full_key(key: str) -> str:
    return f"{_KEY_PREFIX}{key}"


class InMemoryEphemeralStore:
    def __init__(self) -> None:
        self._entries: dict[str, tuple[str, float]] = {}

    def _prune(self, key: str, now: float) -> None:
        rec = self._entries.get(key)
        if rec and rec[1] <= now:
            del self._entries[key]

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        self._entries[_full_key(key)] = (value, time.monotonic() + float(ttl_seconds))

    async def get(self, key: str) -> Optional[str]:
        now = time.monotonic()
        fk = _full_key(key)
        self._prune(fk, now)
        rec = self._entries.get(fk)
        return rec[0] if rec else None

    async def get_del(self, key: str) -> Optional[str]:
        now = time.monotonic()
        fk = _full_key(key)
        self._prune(fk, now)
        rec = self._entries.pop(fk, None)
        return rec[0] if rec else None

    @property
    def backend_name(self) -> str:
        return "memory"


class UpstashEphemeralStore:
    _CONNECT_TIMEOUT = 1.5
    _READ_TIMEOUT = 2.0

    def __init__(self, rest_url: str, rest_token: str) -> None:
        self._url = rest_url.rstrip("/")
        self._token = rest_token
        self._client: Optional[httpx.AsyncClient] = None

    def _client_or_create(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._READ_TIMEOUT, connect=self._CONNECT_TIMEOUT),
                headers={"Authorization": f"Bearer {self._token}"},
            )
        return self._client

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        fk = _full_key(key)
        client = self._client_or_create()
        try:
            resp = await client.post(
                self._url,
                json=["SET", fk, value, "EX", str(int(ttl_seconds))],
            )
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Upstash ephemeral set failed (%s); continuing", e)

    async def get(self, key: str) -> Optional[str]:
        fk = _full_key(key)
        client = self._client_or_create()
        try:
            resp = await client.post(self._url, json=["GET", fk])
            resp.raise_for_status()
            result = resp.json().get("result")
            return str(result) if result is not None else None
        except Exception as e:
            logger.warning("Upstash ephemeral get failed (%s); returning None", e)
            return None

    async def get_del(self, key: str) -> Optional[str]:
        fk = _full_key(key)
        client = self._client_or_create()
        try:
            resp = await client.post(self._url, json=["GETDEL", fk])
            resp.raise_for_status()
            result = resp.json().get("result")
            return str(result) if result is not None else None
        except Exception as e:
            logger.warning("Upstash ephemeral get_del failed (%s); returning None", e)
            return None

    @property
    def backend_name(self) -> str:
        return "upstash"


def build_ephemeral_store(*, rest_url: str = "", rest_token: str = "") -> EphemeralStore:
    if rest_url and rest_token:
        return UpstashEphemeralStore(rest_url, rest_token)
    return InMemoryEphemeralStore()
