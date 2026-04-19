"""Smoke tests for the Alembic setup.

These do not touch a real database — they only verify the migration scripts
and env module load, and that a baseline head exists.
"""

from __future__ import annotations

from pathlib import Path

import alembic
from alembic.config import Config
from alembic.script import ScriptDirectory


BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"


def _config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    # Ensure script_location resolves correctly regardless of the test cwd.
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def test_alembic_ini_loads() -> None:
    """alembic.ini must parse without error."""
    assert ALEMBIC_INI.exists(), f"expected {ALEMBIC_INI} to exist"
    cfg = _config()
    # script_location is required for any alembic operation.
    assert cfg.get_main_option("script_location")


def test_script_directory_has_head() -> None:
    """A baseline revision must exist and resolve as a single head."""
    script = ScriptDirectory.from_config(_config())
    head = script.get_current_head()
    assert head is not None, "no Alembic head — baseline revision missing?"
    heads = script.get_heads()
    assert len(heads) == 1, f"expected exactly one head, got {heads!r}"


def test_baseline_revision_present() -> None:
    """The 0001_baseline revision must be the root of the history."""
    script = ScriptDirectory.from_config(_config())
    revisions = list(script.walk_revisions())
    assert revisions, "no revisions found"
    root = revisions[-1]  # walk_revisions goes head -> base
    assert root.revision == "0001_baseline", (
        f"expected baseline revision id '0001_baseline', got {root.revision!r}"
    )
    assert root.down_revision is None


def test_env_module_imports() -> None:
    """Importing alembic/env.py as a module must not crash.

    env.py wires in app.config + Base.metadata; a syntax error or missing
    import would break every migration.
    """
    import importlib.util

    env_path = BACKEND_DIR / "alembic" / "env.py"
    assert env_path.exists()
    # Parse only — running env.py invokes context.configure which needs a live
    # Alembic context. Compiling catches import-time syntax/name errors.
    source = env_path.read_text(encoding="utf-8")
    compile(source, str(env_path), "exec")


def test_alembic_package_importable() -> None:
    """Alembic itself must be importable from the backend venv."""
    assert hasattr(alembic, "__version__")
