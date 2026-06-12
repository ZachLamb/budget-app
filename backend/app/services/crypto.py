"""Application-level encryption for secrets stored in DB columns.

Fernet (AES-128-CBC + HMAC-SHA256) keyed via HKDF from SECRET_KEY. Values are
prefixed with a version marker so plaintext rows written before encryption
shipped remain readable and are upgraded lazily on next write.

Rotating SECRET_KEY invalidates stored ciphertexts (like it invalidates
sessions) — for SimpleFIN that means reconnecting the bank, which is the
documented recovery path anyway.
"""
from __future__ import annotations

import base64
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings

_PREFIX = "enc:v1:"


@lru_cache
def _fernet() -> Fernet:
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"clarity-column-encryption-v1",
        info=b"fernet-column-key",
    )
    key = hkdf.derive(get_settings().secret_key.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_value(plaintext: str) -> str:
    return _PREFIX + _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_value(stored: str | None) -> str | None:
    """Decrypt a stored value; passes through legacy plaintext unchanged.

    Returns None for None input or for ciphertext that fails authentication
    (e.g. after a SECRET_KEY rotation).
    """
    if stored is None:
        return None
    if not stored.startswith(_PREFIX):
        return stored  # legacy plaintext row
    try:
        return _fernet().decrypt(stored[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def is_encrypted(stored: str | None) -> bool:
    return bool(stored) and stored.startswith(_PREFIX)
