"""Demo guard: auth + explicit mutation allowlist for demo mode."""

from app.middleware.demo_guard import (
    _DEMO_AI_MUTATION_PATHS,
    _DEMO_AUTH_PREFIXES,
    is_demo_ai_mutation_allowed,
    is_demo_mutation_allowed,
)


def test_demo_auth_prefixes_stable() -> None:
    assert "/api/auth/demo-login" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/login" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/logout" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/register" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/passkey/" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/magic-link/" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/google/exchange" in _DEMO_AUTH_PREFIXES


def test_demo_allows_passkey_and_magic_link_auth() -> None:
    assert is_demo_mutation_allowed("/api/auth/passkey/authenticate/options", "POST")
    assert is_demo_mutation_allowed("/api/auth/passkey/authenticate/verify", "POST")
    assert is_demo_mutation_allowed("/api/auth/passkey/register/options", "POST")
    assert is_demo_mutation_allowed("/api/auth/magic-link/request", "POST")
    assert is_demo_mutation_allowed("/api/auth/magic-link/verify", "POST")


def test_demo_ai_mutation_paths_empty_after_cloud_removal() -> None:
    assert _DEMO_AI_MUTATION_PATHS == frozenset()
    assert not is_demo_ai_mutation_allowed("/api/ai/insights", "POST")


def test_demo_ai_blocks_fsa_item_patch() -> None:
    assert not is_demo_ai_mutation_allowed("/api/ai/fsa-review/items/tx-1", "PATCH")


def test_demo_non_ai_product_policy_paths_allowed() -> None:
    assert is_demo_mutation_allowed("/api/settings/pay-schedule", "PUT")
    assert is_demo_mutation_allowed("/api/settings/cycle-review", "PUT")
    assert is_demo_mutation_allowed("/api/cycle-commitments", "POST")
    assert is_demo_mutation_allowed("/api/cycle-commitments/xyz", "PATCH")
    assert is_demo_mutation_allowed("/api/recurring/suggestions/dismiss", "POST")


def test_demo_blocks_categorization_suggest() -> None:
    assert not is_demo_mutation_allowed("/api/categorization/suggest", "POST")
    assert not is_demo_mutation_allowed("/api/categorization/apply", "POST")


def test_demo_blocks_random_api_mutations() -> None:
    assert not is_demo_mutation_allowed("/api/transactions", "POST")
    assert not is_demo_mutation_allowed("/api/accounts/abc", "DELETE")
