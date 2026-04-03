"""Pure-logic tests for recurring detection heuristics."""

from datetime import date
from decimal import Decimal

from app.services.recurring_detection import (
    amounts_similar,
    cluster_rows_by_payee,
    infer_frequency_from_gap_days,
    make_dedupe_key,
    median_decimal,
    project_next_date,
)


def test_amounts_similar_percent():
    assert amounts_similar(Decimal("-50.00"), Decimal("-49.50"))
    assert amounts_similar(Decimal("-100"), Decimal("-99.00"))
    assert not amounts_similar(Decimal("-50"), Decimal("-40"))


def test_amounts_similar_absolute_dollar():
    assert amounts_similar(Decimal("-10.00"), Decimal("-10.80"))


def test_median_decimal():
    assert median_decimal([Decimal("-10"), Decimal("-12"), Decimal("-11")]) == Decimal("-11")


def test_infer_frequency():
    assert infer_frequency_from_gap_days([7, 7, 8]) == "weekly"
    assert infer_frequency_from_gap_days([14, 14]) == "biweekly"
    assert infer_frequency_from_gap_days([30, 31]) == "monthly"
    assert infer_frequency_from_gap_days([3, 400]) is None


def test_cluster_rows():
    pid = "payee-1"
    rows = [
        (date(2026, 1, 1), Decimal("-10"), None, None, pid),
        (date(2026, 1, 8), Decimal("-10.05"), None, None, pid),
        (date(2026, 1, 15), Decimal("-99"), None, None, pid),
    ]
    clusters = cluster_rows_by_payee(rows)
    assert len(clusters) == 1
    assert len(clusters[0]) == 2


def test_make_dedupe_key():
    k = make_dedupe_key("p1", Decimal("-49.995"))
    assert k == "p1:-50.00"


def test_project_next_date_weekly():
    n = project_next_date(date(2026, 3, 1), "weekly", date(2026, 3, 5))
    assert n == date(2026, 3, 8)
