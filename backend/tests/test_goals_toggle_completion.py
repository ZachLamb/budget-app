from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.routes.goals import _apply_completion_state


def test_mark_complete_sets_completed_at() -> None:
    goal = SimpleNamespace(completed_at=None)
    _apply_completion_state(goal, True)
    assert isinstance(goal.completed_at, datetime)


def test_mark_complete_is_idempotent() -> None:
    now = datetime.now(timezone.utc)
    goal = SimpleNamespace(completed_at=now)
    _apply_completion_state(goal, True)
    assert goal.completed_at == now


def test_reopen_clears_completed_at() -> None:
    goal = SimpleNamespace(completed_at=datetime.now(timezone.utc))
    _apply_completion_state(goal, False)
    assert goal.completed_at is None
