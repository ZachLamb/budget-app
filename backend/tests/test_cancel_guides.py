"""Tests for curated subscription cancel guide matching."""

import json
from pathlib import Path

import pytest

from app.services import cancel_guides as cg


def test_normalize_payee():
    assert cg.normalize_payee("Netflix, Inc.") == "netflixinc"
    assert cg.normalize_payee("SPOTIFY USA") == "spotifyusa"


def test_find_netflix():
    m = cg.find_cancel_guide("NETFLIX.COM BILL")
    assert m.matched
    assert m.merchant_key == "netflix"
    assert m.verified_cancel_url
    assert m.steps
    assert cg.show_verified_link_badge(m.verification)


def test_find_spotify_partial():
    m = cg.find_cancel_guide("Spotify PDA")
    assert m.matched
    assert m.merchant_key == "spotify"


def test_no_match_generic():
    m = cg.find_cancel_guide("Totally Unknown Merchant XYZ123")
    assert not m.matched


def test_community_planet_fitness():
    m = cg.find_cancel_guide("PLANET FITNESS CLUB")
    assert m.matched
    assert m.merchant_key == "planet_fitness"
    assert not cg.show_verified_link_badge(m.verification)


def test_guides_json_schema():
    path = Path(__file__).resolve().parent.parent / "data" / "merchant_cancel_guides.json"
    assert path.is_file()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert "guides" in data
    for g in data["guides"]:
        assert "merchant_key" in g
        assert "display_name" in g
        assert isinstance(g.get("aliases"), list)
        assert isinstance(g.get("steps"), list)
        assert g.get("verification") in ("official_docs", "maintainer_curated", "community")
