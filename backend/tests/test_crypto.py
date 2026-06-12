"""Column-encryption helpers (services.crypto)."""
from __future__ import annotations

from app.services.crypto import decrypt_value, encrypt_value, is_encrypted


def test_roundtrip():
    secret = "https://user:pass@beta-bridge.simplefin.org/simplefin"
    stored = encrypt_value(secret)
    assert stored != secret
    assert stored.startswith("enc:v1:")
    assert is_encrypted(stored)
    assert decrypt_value(stored) == secret


def test_legacy_plaintext_passthrough():
    legacy = "https://user:pass@bridge.simplefin.org/simplefin"
    assert not is_encrypted(legacy)
    assert decrypt_value(legacy) == legacy


def test_none_and_tampered():
    assert decrypt_value(None) is None
    stored = encrypt_value("secret")
    tampered = stored[:-2] + "xx"
    assert decrypt_value(tampered) is None


def test_ciphertext_not_deterministic():
    # Fernet includes a random IV — equal plaintexts must not produce equal
    # ciphertexts (prevents equality-based inference on the column).
    assert encrypt_value("same") != encrypt_value("same")
