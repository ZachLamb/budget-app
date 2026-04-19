"""Verify the uvicorn log-config JSON wires up ``app.*`` loggers at INFO.

Without this config, uvicorn's default logging only honors ``uvicorn.*``
loggers — our startup banner (``rate-limit store: ...``) and timing lines
(``ai_llm op=... duration_ms=...``) emit from ``app.*`` loggers and get
silently dropped. This guards against a regression where that config goes
stale (renamed handler, missing logger key) and the banner disappears again.
"""

from __future__ import annotations

import io
import json
import logging
import logging.config
from pathlib import Path

import pytest


LOG_CONFIG_PATH = Path(__file__).resolve().parent.parent / "log_config.json"


def _load_config() -> dict:
    with LOG_CONFIG_PATH.open() as f:
        return json.load(f)


def test_log_config_file_exists() -> None:
    """entrypoint.sh points at /app/log_config.json; the source must exist."""
    assert LOG_CONFIG_PATH.is_file(), f"missing: {LOG_CONFIG_PATH}"


def test_log_config_declares_app_logger_at_info() -> None:
    """The ``app`` logger must be present at INFO and route to a real handler."""
    cfg = _load_config()
    loggers = cfg.get("loggers", {})
    assert "app" in loggers, "log_config.json is missing the 'app' logger entry"

    app_entry = loggers["app"]
    assert app_entry.get("level") == "INFO", (
        "app logger must be INFO (not DEBUG — DEBUG would leak too much; "
        "not WARNING — we'd lose the rate-limit banner and AI timing lines)"
    )
    handlers = app_entry.get("handlers") or []
    assert handlers, "app logger must route to at least one handler"
    declared_handlers = set(cfg.get("handlers", {}).keys())
    for h in handlers:
        assert h in declared_handlers, f"app logger references undeclared handler: {h}"


def test_log_config_preserves_uvicorn_access_format() -> None:
    """Do not break operators' uvicorn access-log parsers — format stays put."""
    cfg = _load_config()
    access = cfg.get("formatters", {}).get("access", {})
    assert access.get("()") == "uvicorn.logging.AccessFormatter"
    assert access.get("fmt") == (
        '%(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
    )


@pytest.fixture()
def configured_logging():
    """Apply the JSON config in-process; restore defaults after.

    We swap the file-declared StreamHandler streams for a single in-memory
    buffer so we can assert on what actually gets emitted, without clobbering
    the real root handlers the test runner may be using.
    """
    cfg = _load_config()
    buffer = io.StringIO()
    # Route every declared handler to our in-memory stream so anything the
    # `app` logger emits lands somewhere we can read.
    for handler_cfg in cfg["handlers"].values():
        handler_cfg["stream"] = buffer
        # DefaultFormatter's level-prefix machinery checks TTY colors via the
        # stream — force colors off to keep output deterministic across CI.
        handler_cfg.setdefault("formatter", handler_cfg.get("formatter"))
    for fmt_cfg in cfg["formatters"].values():
        if fmt_cfg.get("()") == "uvicorn.logging.DefaultFormatter":
            fmt_cfg["use_colors"] = False

    logging.config.dictConfig(cfg)
    try:
        yield buffer
    finally:
        # Reset to a pristine config so other tests aren't affected.
        logging.config.dictConfig(
            {"version": 1, "disable_existing_loggers": False}
        )


def test_app_info_log_is_emitted_under_configured_handlers(configured_logging) -> None:
    """An ``app.*`` logger at INFO must reach the configured stream handler."""
    buffer = configured_logging
    logger = logging.getLogger("app.test_logging_config")
    logger.info("rate-limit store: memory")
    for h in logging.getLogger("app").handlers:
        h.flush()

    output = buffer.getvalue()
    assert "rate-limit store: memory" in output, (
        f"app.* INFO did not reach the configured handler; buffer={output!r}"
    )


def test_app_debug_log_is_suppressed_by_default(configured_logging) -> None:
    """Guardrail: we don't want DEBUG on by default for app.* loggers."""
    buffer = configured_logging
    logger = logging.getLogger("app.test_logging_config")
    logger.debug("should not appear — DEBUG is noisy and may include secrets")
    for h in logging.getLogger("app").handlers:
        h.flush()

    assert "should not appear" not in buffer.getvalue()
