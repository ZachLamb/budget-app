"""Demo guard: auth + explicit AI mutation allowlist + non-AI product-policy paths."""

from app.middleware.demo_guard import (
    _DEMO_AI_MUTATION_PATHS,
    _DEMO_AUTH_PREFIXES,
    is_demo_ai_mutation_allowed,
    is_demo_mutation_allowed,
)


def test_demo_auth_prefixes_stable() -> None:
    assert "/api/auth/demo-login" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/login" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/google/exchange" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/passkey/authenticate/" in _DEMO_AUTH_PREFIXES
    assert "/api/auth/magic-link/" in _DEMO_AUTH_PREFIXES


def test_demo_allows_passkey_and_magic_link_auth() -> None:
    """Passkey and magic-link sign-in must work in demo mode. These are the
    real login surfaces the demo exposes alongside the demo button; blocking
    their POSTs (the bug this guards against) returned 403 and made both
    methods dead-end on the login screen."""
    assert is_demo_mutation_allowed("/api/auth/passkey/authenticate/options", "POST")
    assert is_demo_mutation_allowed("/api/auth/passkey/authenticate/verify", "POST")
    assert is_demo_mutation_allowed("/api/auth/magic-link/request", "POST")
    assert is_demo_mutation_allowed("/api/auth/magic-link/verify", "POST")


def test_demo_still_blocks_account_creation() -> None:
    """The demo disables sign-up (the login UI hides it). Allowing passkey
    SIGN-IN must not accidentally open passkey REGISTRATION or password
    register, which would let anyone create real accounts on the demo
    backend."""
    assert not is_demo_mutation_allowed("/api/auth/passkey/register/options", "POST")
    assert not is_demo_mutation_allowed("/api/auth/passkey/register/verify", "POST")
    assert not is_demo_mutation_allowed("/api/auth/register", "POST")


def test_demo_ai_allowed_llm_routes() -> None:
    assert is_demo_ai_mutation_allowed("/api/ai/chat/stream", "POST")
    assert is_demo_ai_mutation_allowed("/api/ai/insights", "POST")
    assert is_demo_ai_mutation_allowed("/api/ai/fsa-review", "POST")


def test_demo_ai_blocks_execute_and_fsa_item_patch() -> None:
    assert not is_demo_ai_mutation_allowed("/api/ai/execute-action", "POST")
    assert not is_demo_ai_mutation_allowed("/api/ai/fsa-review/items/tx-1", "PATCH")


def test_demo_ai_rejects_unknown_subpath_even_when_it_shares_a_prefix() -> None:
    # Regression: prior prefix matching would auto-allow any future route whose
    # path starts with an existing allowed path. Exact matching blocks these.
    assert not is_demo_ai_mutation_allowed("/api/ai/parse-action-v2", "POST")
    assert not is_demo_ai_mutation_allowed("/api/ai/insights/refresh", "POST")
    assert not is_demo_ai_mutation_allowed("/api/ai/chat/stream/extra", "POST")
    assert not is_demo_ai_mutation_allowed("/api/ai/fsa-review/export", "POST")


def test_demo_non_ai_product_policy_paths_allowed() -> None:
    """Non-AI paths the demo needs for its observe/diagnose/decide loop to work:
    pay-schedule + cycle-commitments + cycle-review + recurring-suggestion
    dismissal. Blocking these broke the demo's guided tour, so they stay
    allowed even though the rest of the app is read-only."""
    assert is_demo_mutation_allowed("/api/settings/pay-schedule", "PUT")
    assert is_demo_mutation_allowed("/api/settings/cycle-review", "PUT")
    assert is_demo_mutation_allowed("/api/cycle-commitments", "POST")
    assert is_demo_mutation_allowed("/api/cycle-commitments/xyz", "PATCH")
    assert is_demo_mutation_allowed("/api/recurring/suggestions/dismiss", "POST")


def test_demo_allows_categorization_suggest_only() -> None:
    assert is_demo_mutation_allowed("/api/categorization/suggest", "POST")
    assert not is_demo_mutation_allowed("/api/categorization/apply", "POST")
    assert not is_demo_mutation_allowed("/api/categorization/apply-rules", "POST")


def test_demo_allows_advisor_turn_post() -> None:
    """`/api/ai/advisor-turn` is the single-call chat/action endpoint;
    demo needs it allowed for the Advisor panel to work read-only."""
    assert is_demo_ai_mutation_allowed("/api/ai/advisor-turn", "POST")


def test_demo_ai_path_list_nonempty() -> None:
    assert len(_DEMO_AI_MUTATION_PATHS) >= 7


def test_every_demo_allowlisted_path_resolves_to_a_real_route() -> None:
    """Safeguard: a stale path in the allowlist (typo or deleted route) would
    create a phantom "allowed" entry that does nothing in prod but misleads
    anyone auditing the demo surface. Fail fast if the set drifts from the
    actual route registry.
    """
    from app.main import app

    registered = {getattr(r, "path", None) for r in app.routes}
    registered.discard(None)
    missing = {p for p in _DEMO_AI_MUTATION_PATHS if p not in registered}
    assert not missing, (
        f"_DEMO_AI_MUTATION_PATHS references paths that aren't registered in "
        f"app.routes: {sorted(missing)}. Either the route was renamed/removed "
        f"or the allowlist entry has a typo."
    )


def test_demo_blocks_random_api_mutations() -> None:
    """Anything outside the explicit allowlists stays blocked."""
    assert not is_demo_mutation_allowed("/api/transactions", "POST")
    assert not is_demo_mutation_allowed("/api/accounts/abc", "DELETE")
