"""Guard the back-test harness itself.

The back-test is an acceptance gate, and a gate that cannot fail is worse
than no gate. These tests use synthetic figures computed by hand from the
2026 published tables -- no real return data -- so they run everywhere,
including CI where returns.local.json never exists.
"""
from __future__ import annotations

import json

import pytest

from tests.backtest import test_filed_returns as backtest

# Hand-computed from the 2026 single tables, independently of the engine:
#   taxable        179,000 - 16,100 standard          = 162,900.00
#   federal        12,400 x .10                       =   1,240.00
#                  (50,400 - 12,400) x .12            =   4,560.00
#                  (105,700 - 50,400) x .22           =  12,166.00
#                  (162,900 - 105,700) x .24          =  13,728.00  -> 31,694.00
#   Colorado       162,900 x .044                     =   7,167.60
#   Soc. Sec.      179,000 x .062 (under the base)    =  11,098.00
#   Medicare       179,000 x .0145, no surtax         =   2,595.50
CORRECT = {
    "year": 2026,
    "filing_status": "single",
    "wages": "179000.00",
    "actual_taxable_income": "162900.00",
    "actual_federal_income_tax": "31694.00",
    "actual_state_tax": "7167.60",
    "actual_ss_tax": "11098.00",
    "actual_medicare_tax": "2595.50",
}


def _with_fixture(monkeypatch, tmp_path, returns: list[dict]):
    path = tmp_path / "returns.local.json"
    path.write_text(json.dumps({"returns": returns}))
    monkeypatch.setattr(backtest, "FIXTURE", path)


def test_skips_when_the_fixture_is_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(backtest, "FIXTURE", tmp_path / "nope.json")
    with pytest.raises(pytest.skip.Exception):
        backtest.test_engine_reproduces_each_filed_return()


def test_passes_on_figures_computed_by_hand(monkeypatch, tmp_path):
    _with_fixture(monkeypatch, tmp_path, [CORRECT])
    backtest.test_engine_reproduces_each_filed_return()


def test_reports_a_wrong_figure_with_its_direction(monkeypatch, tmp_path):
    _with_fixture(monkeypatch, tmp_path, [{**CORRECT, "actual_federal_income_tax": "31000.00"}])
    with pytest.raises(AssertionError) as exc:
        backtest.test_engine_reproduces_each_filed_return()
    assert "actual_federal_income_tax off by $694.00 (engine high)" in str(exc.value)


def test_a_return_with_no_expected_figures_fails(monkeypatch, tmp_path):
    """Otherwise a fixture of bare inputs would report a green gate."""
    _with_fixture(monkeypatch, tmp_path, [{"year": 2026, "filing_status": "single", "wages": "50000.00"}])
    with pytest.raises(AssertionError, match="no expected figures"):
        backtest.test_engine_reproduces_each_filed_return()


def test_a_year_without_rates_fails_rather_than_skipping(monkeypatch, tmp_path):
    _with_fixture(monkeypatch, tmp_path, [{**CORRECT, "year": 1999}])
    with pytest.raises(AssertionError, match="no rate table"):
        backtest.test_engine_reproduces_each_filed_return()


def test_every_discrepancy_is_reported_in_one_run(monkeypatch, tmp_path):
    _with_fixture(
        monkeypatch,
        tmp_path,
        [
            {**CORRECT, "actual_state_tax": "6000.00"},
            {**CORRECT, "year": 1999},
        ],
    )
    with pytest.raises(AssertionError) as exc:
        backtest.test_engine_reproduces_each_filed_return()
    message = str(exc.value)
    assert "actual_state_tax off by" in message
    assert "no rate table" in message
