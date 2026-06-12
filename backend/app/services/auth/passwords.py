"""Password hashing with bcrypt directly (passlib is unmaintained).

Hashes produced by the previous passlib[bcrypt] setup are standard
``$2b$``-prefixed bcrypt strings, so existing rows verify unchanged.
"""
from __future__ import annotations

import bcrypt

# bcrypt ignores everything past 72 bytes. passlib truncated silently; we do
# the same explicitly so long passphrases keep verifying identically.
_BCRYPT_MAX_BYTES = 72


def _password_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_password_bytes(password), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed/unknown hash format — treat as non-matching.
        return False
