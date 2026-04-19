"""OpenAPI contract snapshot.

The frontend's `lib/api/*` TypeScript clients are hand-kept; if a backend
route changes its path, method, body schema, or response schema without a
matching FE update, the drift only shows up when an end-user hits the
broken call. This test pins a normalized shape-only snapshot of
`app.openapi()` so any such drift fails CI and the developer has to
either update both sides or refresh the snapshot explicitly.

To refresh intentionally:

    UPDATE_SNAPSHOTS=1 python -m pytest tests/test_openapi_shape.py

Inspect the diff in `tests/snapshots/openapi.shape.json` before committing
it along with your BE change — that diff is the one FE reviewers should
eyeball against `frontend/src/lib/api/*`.
"""
from __future__ import annotations

import difflib
import json
import os
from pathlib import Path
from typing import Any

from app.main import app

_SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "openapi.shape.json"


def _shape(openapi: dict[str, Any]) -> dict[str, Any]:
    """Strip volatile/cosmetic fields so the snapshot is stable across PRs.

    We drop anything that doesn't affect the wire contract: docstrings,
    FastAPI auto-generated operationIds (they're a function of the route
    name and change when routes are renamed), tags, examples. What remains
    is the request/response schema shape the FE actually relies on.
    """
    paths: dict[str, Any] = {}
    for path, methods in sorted((openapi.get("paths") or {}).items()):
        paths[path] = {}
        for method, op in sorted(methods.items()):
            # Only known HTTP methods; ignore parameters on the path level.
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            paths[path][method] = {
                "requestBody": op.get("requestBody"),
                "responses": {
                    code: {"content": body.get("content")}
                    for code, body in (op.get("responses") or {}).items()
                },
                "parameters": [
                    {
                        "name": p.get("name"),
                        "in": p.get("in"),
                        "required": p.get("required", False),
                        "schema": p.get("schema"),
                    }
                    for p in op.get("parameters") or []
                ],
            }

    components = openapi.get("components") or {}
    return {
        "paths": paths,
        # Named schemas are shared by many routes; drift here propagates
        # silently through every consumer of the FE type. Snapshot them too.
        "components": {"schemas": components.get("schemas") or {}},
    }


def test_openapi_shape_matches_snapshot() -> None:
    current = _shape(app.openapi())
    current_str = json.dumps(current, indent=2, sort_keys=True)

    update = os.environ.get("UPDATE_SNAPSHOTS") == "1"
    if update or not _SNAPSHOT_PATH.exists():
        _SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        _SNAPSHOT_PATH.write_text(current_str + "\n")
        assert _SNAPSHOT_PATH.exists(), "failed to write snapshot"
        return

    saved_str = _SNAPSHOT_PATH.read_text().rstrip("\n")
    if saved_str != current_str:
        # Print the first ~60 lines of the diff so CI logs make it obvious
        # what drifted. Truncating keeps the failure readable; the full
        # diff is always visible locally after regenerating the snapshot.
        diff = difflib.unified_diff(
            saved_str.splitlines(),
            current_str.splitlines(),
            fromfile="snapshot",
            tofile="current",
            lineterm="",
            n=2,
        )
        head = "\n".join(list(diff)[:80])
        raise AssertionError(
            "OpenAPI shape drift vs "
            f"{_SNAPSHOT_PATH.relative_to(Path.cwd())}.\n"
            "If the change is intentional, refresh the snapshot and "
            "review the diff for matching FE updates:\n"
            "    UPDATE_SNAPSHOTS=1 python -m pytest "
            "tests/test_openapi_shape.py\n"
            "Then eyeball the diff against frontend/src/lib/api/* before "
            "committing.\n\n"
            "First 80 lines of the drift:\n"
            f"{head}"
        )
