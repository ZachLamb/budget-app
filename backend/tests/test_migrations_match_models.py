"""The migration chain must replay from nothing, and land on the models.

Two facts about this project make a whole class of schema bug invisible:

1. The rest of the suite builds SQLite straight from `Base.metadata`, so
   every column the models declare exists under test whether or not any
   migration creates it.
2. `0001_baseline` calls `create_all()` against the CURRENT models, so a
   fresh database gets today's columns, while a database stamped when
   the models were older gets only what the later deltas added. The two
   are not the same schema.

Together they let a column be added to a model, missed in its migration,
and never noticed: fresh installs have it (from the baseline), the tests
have it (from the metadata), and only a database that was migrated over
time is missing it. That is exactly how `prior_year_returns.state` came
to break every load of the Taxes page -- found by opening the app, not
by the 733 tests that were passing at the time.

This module runs the real chain against a throwaway database. It catches
the other half of the same problem: a delta that assumes its column is
absent will crash on a fresh install, where the baseline already made
it.
"""
from __future__ import annotations

import os
import pathlib
import tempfile
from unittest import mock

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.database import Base
import app.models  # noqa: F401 -- registers every table on Base.metadata

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _run_chain(target: str = "head"):
    """Migrate an empty database and return {table: {columns}}.

    `alembic/env.py` overwrites `sqlalchemy.url` from the app settings,
    so setting it on the Config alone is not enough -- doing only that
    would silently migrate whatever database the developer is running,
    which is the opposite of what a test should do. The env var and the
    settings cache are both overridden so the migrations can only reach
    the throwaway file.
    """
    from app.config import get_settings

    with tempfile.TemporaryDirectory() as tmp:
        db_path = pathlib.Path(tmp) / "migrated.sqlite"
        url = f"sqlite:///{db_path}"

        cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
        cfg.set_main_option("sqlalchemy.url", url)

        with mock.patch.dict(
            os.environ, {"DATABASE_URL_SYNC": url, "DATABASE_URL": url}
        ):
            get_settings.cache_clear()
            try:
                command.upgrade(cfg, target)
                engine = create_engine(url)
                try:
                    inspector = inspect(engine)
                    return {
                        table: {c["name"] for c in inspector.get_columns(table)}
                        for table in inspector.get_table_names()
                        if table != "alembic_version"
                    }
                finally:
                    engine.dispose()
            finally:
                get_settings.cache_clear()


@pytest.fixture(scope="module")
def migrated():
    return _run_chain()


def test_the_chain_replays_from_an_empty_database(migrated):
    """`alembic upgrade head` on nothing must simply work.

    It stops working the moment a delta does an unguarded ADD COLUMN for
    something the model-derived baseline already created -- which fails
    every fresh install while every existing one is fine.
    """
    assert migrated, "the chain produced no tables at all"


def test_every_model_table_survives_the_chain(migrated):
    missing = sorted(set(Base.metadata.tables) - set(migrated))
    assert not missing, (
        f"These tables are in the models but not in a migrated database: "
        f"{missing}."
    )


def test_every_model_column_survives_the_chain(migrated):
    problems: list[str] = []
    for name, table in Base.metadata.tables.items():
        if name not in migrated:
            continue
        missing = sorted({c.name for c in table.columns} - migrated[name])
        if missing:
            problems.append(f"{name}: {missing}")
    assert not problems, (
        "These columns are in the models but not in a migrated database:\n  "
        + "\n  ".join(problems)
    )


def test_the_chain_leaves_nothing_the_models_dropped(migrated):
    """A table the migrations still create but the models no longer
    declare is either a migration never written or dead weight -- both
    worth knowing about."""
    extra = sorted(set(migrated) - set(Base.metadata.tables))
    assert not extra, (
        f"A migrated database has tables the models do not declare: {extra}."
    )
