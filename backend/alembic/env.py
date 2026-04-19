"""Alembic environment configuration.

Overrides the placeholder URL in alembic.ini with the sync DSN from
app.config.get_settings().database_url_sync, and points autogenerate at
Base.metadata (populated by importing app.models).

We deliberately use the SYNC URL (psycopg2) here because Alembic's offline
path and autogenerate do not support asyncpg — online DDL also works fine
on the sync driver.
"""

from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Import settings + Base (and populate Base.metadata by importing all models).
from app.config import get_settings
from app.database import Base
import app.models  # noqa: F401  (registers models on Base.metadata)


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override whatever placeholder alembic.ini has with the real sync DSN.
# Alembic's offline/autogenerate don't understand asyncpg; always use sync.
_settings = get_settings()
config.set_main_option("sqlalchemy.url", _settings.database_url_sync)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emits SQL to stdout."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — connect and apply."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
