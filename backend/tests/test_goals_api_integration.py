from __future__ import annotations

import pytest

pytestmark = pytest.mark.skip(reason="Requires async test DB + app client wiring in conftest.")


async def test_create_goal_happy_path() -> None:
    """Placeholder integration test:
    - create a goal through API
    - assert response includes bounded progress fields
    """


async def test_update_goal_rejects_invalid_account_ownership() -> None:
    """Placeholder integration test:
    - update goal with account_id from another household
    - assert 404 account not found
    """


async def test_delete_goal_happy_path() -> None:
    """Placeholder integration test:
    - delete goal
    - assert goal no longer appears in list endpoint
    """
