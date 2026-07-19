"""Deterministic subscription price-increase detection
(app/services/subscription_price.py)."""
from app.services.subscription_price import PriceChange, detect_price_changes


def test_flags_clear_step_up():
    out = detect_price_changes({"Netflix": [15.49, 15.49, 15.99]})
    assert len(out) == 1
    c = out[0]
    assert isinstance(c, PriceChange)
    assert c.key == "Netflix"
    assert c.previous_amount == 15.49
    assert c.current_amount == 15.99
    assert c.pct_change == 3.2


def test_no_flag_when_price_is_flat():
    assert detect_price_changes({"Spotify": [10.99, 10.99, 10.99]}) == []


def test_no_flag_on_price_decrease():
    assert detect_price_changes({"Gym": [30.0, 25.0]}) == []


def test_suppresses_return_to_prior_price_wobble():
    # 15.99 → 15.49 → 15.99: latest is not a new high, so not a real increase.
    assert detect_price_changes({"News": [15.99, 15.49, 15.99]}) == []


def test_below_absolute_threshold_not_flagged():
    # +$0.25 increase is below the $0.50 floor.
    assert detect_price_changes({"App": [4.99, 5.24]}, min_abs=0.50) == []


def test_below_percent_threshold_not_flagged():
    # +$0.60 on a $200 charge is only 0.3% — below the 1% floor.
    assert detect_price_changes({"Insurance": [200.00, 200.60]}, min_pct=1.0) == []


def test_uses_absolute_value_for_outflow_amounts():
    # Charges stored as negative outflows are normalized to magnitudes.
    out = detect_price_changes({"Cloud": [-9.99, -12.99]})
    assert len(out) == 1
    assert out[0].previous_amount == 9.99
    assert out[0].current_amount == 12.99


def test_single_charge_series_skipped():
    assert detect_price_changes({"New": [19.99]}) == []


def test_sorted_by_pct_desc_and_limited():
    out = detect_price_changes(
        {
            "A": [10.0, 11.0],   # +10%
            "B": [10.0, 15.0],   # +50%
            "C": [10.0, 12.0],   # +20%
        },
        limit=2,
    )
    assert [c.key for c in out] == ["B", "C"]
