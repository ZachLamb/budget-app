"""Demo guard: auth + explicit AI mutation allowlist."""

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


def test_demo_extended_read_only_no_cycle_or_pay_schedule() -> None:
    assert not is_demo_mutation_allowed("/api/cycle-commitments", "POST")
    assert not is_demo_mutation_allowed("/api/settings/pay-schedule", "PUT")
    assert not is_demo_mutation_allowed("/api/recurring/suggestions/dismiss", "POST")


def test_demo_allows_categorization_suggest_only() -> None:
    assert is_demo_mutation_allowed("/api/categorization/suggest", "POST")
    assert not is_demo_mutation_allowed("/api/categorization/apply", "POST")
    assert not is_demo_mutation_allowed("/api/categorization/apply-rules", "POST")


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
