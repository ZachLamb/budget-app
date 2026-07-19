"""Deterministic pay-cycle summary assembler (app/services/ai/cycle_summary.py)."""
from app.services.ai.cycle_summary import assemble_cycle_summary


def _base(**over):
    args = dict(
        window_label="Jul 1–15",
        income_in_window=4800.0,
        spent_in_window=3158.85,
        spending_patterns=[],
        overspent=[],
        cycle_steps={"observed": False, "diagnosed": False, "decided": False},
        open_commitments=0,
    )
    args.update(over)
    return assemble_cycle_summary(**args)


def test_computes_net_and_rounds():
    out = _base(income_in_window=4800.0, spent_in_window=3158.85)
    assert out["income"] == 4800.0
    assert out["spent"] == 3158.85
    assert out["net"] == 1641.15


def test_top_movers_drops_stable_and_sorts_by_abs_pct():
    out = _base(
        spending_patterns=[
            {"category": "Dining", "trend": "up", "pct_change": 12.0},
            {"category": "Gas", "trend": "stable", "pct_change": 2.0},
            {"category": "Travel", "trend": "down", "pct_change": -40.0},
        ]
    )
    assert [m["category"] for m in out["top_movers"]] == ["Travel", "Dining"]
    assert all(m["direction"] in ("up", "down") for m in out["top_movers"])


def test_top_movers_capped():
    patterns = [
        {"category": f"C{i}", "trend": "up", "pct_change": float(i)}
        for i in range(1, 10)
    ]
    out = _base(spending_patterns=patterns, max_movers=2)
    assert len(out["top_movers"]) == 2
    assert out["top_movers"][0]["category"] == "C9"  # largest first


def test_overspent_filters_nonpositive_and_sorts():
    out = _base(
        overspent=[
            {"category": "Dining", "over_by": 27.5},
            {"category": "Gas", "over_by": 0},
            {"category": "Rent", "over_by": -5},
            {"category": "Internet", "over_by": 86.36},
        ]
    )
    assert [o["category"] for o in out["overspent"]] == ["Internet", "Dining"]


def test_next_step_walks_observe_diagnose_decide():
    assert _base(cycle_steps={"observed": False})["next_step"] == "review this window's spending"
    assert (
        _base(cycle_steps={"observed": True, "diagnosed": False})["next_step"]
        == "identify what drove the changes"
    )
    assert (
        _base(cycle_steps={"observed": True, "diagnosed": True, "decided": False})["next_step"]
        == "decide on an adjustment"
    )


def test_next_step_commitments_then_on_track():
    done = {"observed": True, "diagnosed": True, "decided": True}
    assert _base(cycle_steps=done, open_commitments=2)["next_step"] == "follow through on 2 commitments"
    assert _base(cycle_steps=done, open_commitments=1)["next_step"] == "follow through on 1 commitment"
    assert _base(cycle_steps=done, open_commitments=0)["next_step"].startswith("you're on track")


def test_cycle_progress_coerces_to_bool():
    out = _base(cycle_steps={"observed": True, "diagnosed": True, "decided": False})
    assert out["cycle_progress"] == {"observed": True, "diagnosed": True, "decided": False}
