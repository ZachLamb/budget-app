"""Back-test: reproduce real filed returns.

Unit tests prove the engine matches published examples. This proves it
reproduces actual filed returns -- the real situation, including
Schedule E and Colorado.

Reads ``returns.local.json`` from this directory. That file is GITIGNORED
and must never be committed: it describes a real person's finances. The
test SKIPS when it is absent, so CI and other machines stay green.

See README.md in this directory for the file format and where each figure
comes from on the forms.
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.tax.engine import project
from app.services.tax.inputs import (
    ScheduleEResult,
    TaxInputs,
    TaxProjection,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import (
    FilingStatus,
    RateSet,
    UnknownTaxYearError,
    UnsupportedFilingStatusError,
    get_rates,
)

FIXTURE = Path(__file__).parent / "returns.local.json"
TOLERANCE = Decimal("25.00")

# Each expected figure is checked against ONE engine output, because the
# engine's own `total_liability` is federal + FICA + state and no single
# line on any filed form means that. Comparing it to Form 1040 line 24
# (federal only) would be off by the whole state and FICA bill -- roughly
# $20k on a six-figure return -- and would look like an engine defect.
CHECKS: list[tuple[str, str, str]] = [
    ("actual_taxable_income", "taxable_income", "Form 1040 line 15"),
    ("actual_federal_income_tax", "federal_income_tax", "Form 1040 line 16"),
    ("actual_state_tax", "state_tax", "Colorado DR 0104 net tax"),
    ("actual_ss_tax", "social_security_tax", "W-2 box 4"),
    ("actual_medicare_tax", "_medicare_total", "W-2 box 6"),
]


def _load() -> list[dict]:
    if not FIXTURE.exists():
        pytest.skip(
            "No returns.local.json. Copy the shape from README.md to run the "
            "back-test locally; it is gitignored by design."
        )
    return json.loads(FIXTURE.read_text())["returns"]


def _dec(value) -> Decimal:
    return Decimal(str(value))


def _actual(projection: TaxProjection, attr: str) -> Decimal:
    # W-2 box 6 is the whole Medicare bill, so the engine's two Medicare
    # components have to be added back together to compare against it.
    if attr == "_medicare_total":
        return projection.medicare_tax + projection.additional_medicare_tax
    return getattr(projection, attr)


def _inputs_from(record: dict) -> TaxInputs:
    schedule_e = None
    if record.get("schedule_e"):
        se = record["schedule_e"]
        schedule_e = ScheduleEResult(
            gross_rental_income=_dec(se["gross_rental_income"]),
            allowable_expenses=_dec(se["allowable_expenses"]),
            net=_dec(se["net"]),
            active_participation=se.get("active_participation", True),
            suspended_loss_carryin=_dec(se.get("suspended_loss_carryin", 0)),
        )
    return TaxInputs(
        filing_status=FilingStatus(record["filing_status"]),
        # A filed return is a finished year: everything is actual, nothing
        # is projected.
        wages_ytd=_dec(record["wages"]),
        projected_remaining_wages=Decimal("0"),
        pretax_401k=_dec(record.get("pretax_401k", 0)),
        pretax_hsa=_dec(record.get("pretax_hsa", 0)),
        pretax_other=_dec(record.get("pretax_other", 0)),
        federal_withheld_ytd=_dec(record.get("federal_withheld", 0)),
        state_withheld_ytd=_dec(record.get("state_withheld", 0)),
        ss_withheld_ytd=_dec(record.get("ss_withheld", 0)),
        medicare_withheld_ytd=_dec(record.get("medicare_withheld", 0)),
        projected_remaining_withholding=WithholdingBuckets.zero(),
        itemized_deductions=_dec(record.get("itemized_deductions", 0)),
        schedule_e=schedule_e,
        prior_year_total_tax=None,
        prior_year_agi=None,
    )


def _rates_for(record: dict, failures: list[str]) -> RateSet | None:
    year = record["year"]
    try:
        return get_rates(year)
    except UnknownTaxYearError:
        # A year with no rate table FAILS rather than skipping: silently
        # passing over it would report a green back-test that tested nothing.
        failures.append(f"{year}: no rate table for this year — add its sourced rate module")
        return None


def test_engine_reproduces_each_filed_return():
    records = _load()
    assert records, "returns.local.json contains no returns"

    failures: list[str] = []
    for record in records:
        year = record["year"]
        rates = _rates_for(record, failures)
        if rates is None:
            continue

        compared = [key for key, _, _ in CHECKS if key in record]
        if not compared:
            failures.append(
                f"{year}: no expected figures. Give at least one of "
                f"{[key for key, _, _ in CHECKS]}, or the year proves nothing."
            )
            continue

        try:
            projection = project(_inputs_from(record), rates)
        except UnsupportedFilingStatusError as exc:
            failures.append(f"{year}: {exc}")
            continue

        for key, attr, source in CHECKS:
            if key not in record:
                continue
            expected = _dec(record[key])
            actual = _actual(projection, attr)
            delta = actual - expected
            if abs(delta) > TOLERANCE:
                direction = "engine high" if delta > 0 else "engine low"
                failures.append(
                    f"{year}: {key} off by ${abs(delta)} ({direction}) — "
                    f"engine ${actual}, filed ${expected} ({source})"
                )

    assert not failures, "Back-test failures:\n  " + "\n  ".join(failures)
