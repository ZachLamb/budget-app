"""Advisor single-turn JSON normalization."""

from __future__ import annotations

import pytest

from app.api.routes.ai import AdvisorTurnResponse, normalize_advisor_turn_payload


def test_normalize_chat_branch_attaches_evidence() -> None:
    ev = [{"type": "category_spending", "month": "2026-04", "lines": []}]
    out = normalize_advisor_turn_payload(
        {"branch": "chat", "reply": "  Hello there  "},
        model_source="ollama",
        evidence_list=ev,
    )
    assert isinstance(out, AdvisorTurnResponse)
    assert out.branch == "chat"
    assert out.reply == "Hello there"
    assert out.model_source == "ollama"
    assert out.evidence == ev


def test_normalize_action_branch() -> None:
    out = normalize_advisor_turn_payload(
        {
            "branch": "action",
            "action_type": "add_transaction",
            "data": {"payee_name": "Cafe", "amount": 5.0},
            "confirmation_text": "Add $5 to Cafe",
        },
        model_source="demo",
        evidence_list=[],
    )
    assert out.branch == "action"
    assert out.action_type == "add_transaction"
    assert out.data == {"payee_name": "Cafe", "amount": 5.0}
    assert out.confirmation_text == "Add $5 to Cafe"
    assert out.evidence == []


@pytest.mark.parametrize(
    "raw",
    [
        {"branch": "action", "action_type": "bad", "data": {}, "confirmation_text": "x"},
        {"branch": "chat", "reply": ""},
        {"branch": "other", "reply": "x"},
    ],
)
def test_normalize_rejects_invalid(raw: dict) -> None:
    with pytest.raises(ValueError):
        normalize_advisor_turn_payload(raw, model_source="ollama", evidence_list=[])
