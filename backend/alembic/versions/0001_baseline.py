"""baseline — full schema from Base.metadata.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-04-18

This single revision captures the complete schema as defined by
``app.models`` / ``Base.metadata`` at the time Alembic was introduced.

Prior to Alembic, schema was produced by ``Base.metadata.create_all`` plus a
series of inline ``_run_*_migration`` helpers in ``app/main.py``. Every
column/table those helpers added is now encoded on the ORM models
themselves, so calling ``create_all`` here reproduces the post-all-migrations
schema exactly.

Operators with an already-deployed database should run once::

    cd backend && alembic stamp head

to mark this baseline as applied without re-creating tables. Fresh databases
get the schema via ``alembic upgrade head``.
"""

from __future__ import annotations

from alembic import op

from app.database import Base
import app.models  # noqa: F401  (ensure every model registers on Base.metadata)


# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create every table defined on Base.metadata (idempotent via checkfirst)."""
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    """Drop every table defined on Base.metadata.

    Intentionally destructive — only used for test teardown or full resets.
    """
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
