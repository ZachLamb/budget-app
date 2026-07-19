"""Deterministic payee normalization + duplicate clustering
(app/services/payee_dedup.py)."""
from app.services.payee_dedup import (
    DuplicateCluster,
    PayeeView,
    find_duplicate_clusters,
    normalize_payee_name,
)


def test_normalize_strips_pos_prefix():
    assert normalize_payee_name("SQ *BLUE BOTTLE") == "blue bottle"
    assert normalize_payee_name("TST* Blue Bottle") == "blue bottle"
    assert normalize_payee_name("PAYPAL *SPOTIFY") == "spotify"


def test_normalize_strips_trailing_store_number():
    assert normalize_payee_name("Shell Oil #4471") == "shell oil"
    assert normalize_payee_name("Target # 12") == "target"


def test_normalize_folds_punctuation_and_case():
    assert normalize_payee_name("Trader Joe's") == "trader joe s"
    assert normalize_payee_name("  Blue-Bottle,  Coffee ") == "blue bottle coffee"


def test_normalize_empty_and_noise_only():
    assert normalize_payee_name("") == ""
    assert normalize_payee_name("###") == ""


def test_clusters_variants_of_same_merchant():
    payees = [
        PayeeView("1", "SQ *BLUE BOTTLE #4471"),
        PayeeView("2", "Blue Bottle"),
        PayeeView("3", "TST* Blue Bottle"),
    ]
    clusters = find_duplicate_clusters(payees)
    assert len(clusters) == 1
    c = clusters[0]
    assert isinstance(c, DuplicateCluster)
    assert c.normalized_key == "blue bottle"
    # "Blue Bottle" is the cleanest (no digits/symbols) → canonical.
    assert c.canonical_name == "Blue Bottle"
    assert c.canonical_id == "2"
    assert set(c.duplicate_ids) == {"1", "3"}


def test_no_cluster_for_distinct_payees():
    payees = [PayeeView("1", "Netflix"), PayeeView("2", "Spotify")]
    assert find_duplicate_clusters(payees) == []


def test_singletons_are_not_clusters():
    payees = [PayeeView("1", "Blue Bottle"), PayeeView("2", "Netflix")]
    assert find_duplicate_clusters(payees) == []


def test_canonical_prefers_cleanest_name():
    payees = [
        PayeeView("1", "AMAZON #123"),
        PayeeView("2", "Amazon"),
        PayeeView("3", "SQ *AMAZON"),
    ]
    clusters = find_duplicate_clusters(payees)
    assert len(clusters) == 1
    # All normalize to "amazon"; "Amazon" is the cleanest display form.
    assert clusters[0].canonical_name == "Amazon"
    assert clusters[0].canonical_id == "2"


def test_conservative_no_merge_on_differing_descriptor_bodies():
    # "amazon mktplace" != "amazon" != "amazon com 2a4": distinct keys, no merge.
    # (Catching these is the deferred LLM-fuzzy case, not the deterministic core.)
    payees = [
        PayeeView("1", "AMAZON MKTPLACE"),
        PayeeView("2", "Amazon"),
        PayeeView("3", "AMAZON.COM*2A4"),
    ]
    assert find_duplicate_clusters(payees) == []


def test_blank_names_are_skipped():
    payees = [PayeeView("1", ""), PayeeView("2", "   "), PayeeView("3", "Netflix")]
    assert find_duplicate_clusters(payees) == []


def test_clusters_sorted_by_member_count_desc():
    payees = [
        PayeeView("a1", "Costco"),
        PayeeView("a2", "COSTCO #5"),
        PayeeView("b1", "Kroger"),
        PayeeView("b2", "KROGER #9"),
        PayeeView("b3", "SQ *KROGER"),
    ]
    clusters = find_duplicate_clusters(payees)
    assert [c.normalized_key for c in clusters] == ["kroger", "costco"]
    assert len(clusters[0].member_names) == 3
