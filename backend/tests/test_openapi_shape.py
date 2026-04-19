"""OpenAPI contract snapshot — routes and schema *names*, not schema bodies.

The frontend's `lib/api/*` TypeScript clients are hand-kept; if a backend
route is added, removed, renamed, or changes method/schema-reference, the
drift doesn't show up until an end-user hits the broken call. This test
snapshots the *shape* that matters for FE coupling so such drift fails CI.

**Why schema-reference names, not full schema bodies:** pydantic's
JSON-schema serialization changes across minor versions (emitted
``pattern`` on Decimal fields, ``contentMediaType`` vs ``format: binary``
on file uploads, handling of ``Optional[X] = None``). Those are not real
contract changes — they're version-dependent serializer output — but
they flip the full-body snapshot on every environment swap. Pinning to
schema names keeps the test meaningful (FE consumers reference
``DebtPlanSuggestion`` by name, not by its field list) while removing
the noise.

Real FE-visible changes still fail the test:
- New route or deleted route.
- Method change on an existing route.
- Request/response type renamed.
- Parameter added or removed on a path / query.
- Response code set changes.

Field-level drift within a schema is NOT caught here; if you want that
guard, regenerate the FE types from ``/openapi.json`` in a separate
step and commit the diff.

To refresh intentionally:

    UPDATE_SNAPSHOTS=1 python -m pytest tests/test_openapi_shape.py
"""
from __future__ import annotations

import difflib
import json
import os
import re
from pathlib import Path
from typing import Any

from app.main import app

_SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "openapi.shape.json"

_REF_PATTERN = re.compile(r"#/components/schemas/([A-Za-z0-9_]+)")


def _schema_refs(obj: Any) -> list[str]:
    """Walk a body/parameter schema and return the ref names it points at."""
    refs: list[str] = []

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "$ref" and isinstance(v, str):
                    m = _REF_PATTERN.match(v)
                    if m:
                        refs.append(m.group(1))
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(obj)
    # De-dup while preserving stable order for sort_keys to land.
    return sorted(set(refs))


def _shape(openapi: dict[str, Any]) -> dict[str, Any]:
    """Shape = set of (path, method) × (request/response schema refs, parameter names).

    What we DO capture per operation:
    - request body schema refs (e.g. `["ChatRequest"]`)
    - response schema refs, keyed by status code
    - path/query parameters: name + location + required flag (not schema body)

    What we DO NOT capture:
    - full schema bodies under `components/schemas` (pydantic minor-version
      noise, not FE-meaningful)
    - operationIds, tags, examples, descriptions, summaries.

    Schema **names** are captured via references in paths; a schema being
    renamed or deleted still breaks the snapshot because its refs disappear.
    """
    paths: dict[str, Any] = {}
    for path, methods in sorted((openapi.get("paths") or {}).items()):
        paths[path] = {}
        for method, op in sorted(methods.items()):
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            paths[path][method] = {
                "request_refs": _schema_refs(op.get("requestBody") or {}),
                "response_refs": {
                    code: _schema_refs((body or {}).get("content") or {})
                    for code, body in sorted((op.get("responses") or {}).items())
                },
                "parameters": sorted(
                    [
                        {
                            "name": p.get("name"),
                            "in": p.get("in"),
                            "required": bool(p.get("required", False)),
                        }
                        for p in (op.get("parameters") or [])
                    ],
                    key=lambda p: (p["in"], p["name"]),
                ),
            }

    # Just the set of named schemas that exist — their bodies aren't part
    # of the snapshot (see module docstring).
    component_names = sorted(
        (openapi.get("components") or {}).get("schemas", {}).keys()
    )

    return {"paths": paths, "component_names": component_names}


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
            "If the change is intentional, refresh the snapshot:\n"
            "    UPDATE_SNAPSHOTS=1 python -m pytest "
            "tests/test_openapi_shape.py\n\n"
            "First 80 lines of the drift:\n"
            f"{head}"
        )
