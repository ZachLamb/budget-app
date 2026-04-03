"""Load curated subscription cancellation guides and match payee names."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

VerificationLevel = Literal["official_docs", "maintainer_curated", "community"]

_DATA_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "merchant_cancel_guides.json"

GENERIC_STEPS = [
    "Sign in to the service’s website or app with the account that pays the bill.",
    "Open account settings, profile, or membership — look for Billing, Subscription, or Manage plan.",
    "Choose cancel, turn off auto-renew, or downgrade; keep any confirmation email.",
    "If you subscribed through Apple, Google Play, or a cable bundle, cancel in that system instead of the merchant site.",
]


def normalize_payee(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


@lru_cache(maxsize=1)
def _load_raw() -> dict[str, Any]:
    if not _DATA_PATH.is_file():
        return {"version": 0, "guides": []}
    with open(_DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def reload_guides_cache() -> None:
    """Clear loader cache (e.g. after tests patch the file)."""
    _load_raw.cache_clear()


def list_guides() -> list[dict[str, Any]]:
    data = _load_raw()
    guides = data.get("guides") or []
    return guides if isinstance(guides, list) else []


def _score_match(payee_norm: str, guide: dict[str, Any]) -> float:
    if not payee_norm:
        return 0.0
    best = 0.0
    display = normalize_payee(str(guide.get("display_name") or ""))
    if display and (display in payee_norm or payee_norm in display):
        best = max(best, 0.95)
    for a in guide.get("aliases") or []:
        an = normalize_payee(str(a))
        if not an:
            continue
        if an == payee_norm:
            best = max(best, 1.0)
        elif an in payee_norm or payee_norm in an:
            best = max(best, 0.85)
        elif payee_norm.startswith(an[: min(4, len(an))]) and len(an) >= 4:
            best = max(best, 0.45)
    key = normalize_payee(str(guide.get("merchant_key") or ""))
    if key and (key in payee_norm or payee_norm in key):
        best = max(best, 0.8)
    return best


@dataclass(frozen=True)
class CancelGuideMatch:
    matched: bool
    merchant_key: Optional[str] = None
    display_name: Optional[str] = None
    verified_cancel_url: Optional[str] = None
    steps: Optional[list[str]] = None
    verification: Optional[VerificationLevel] = None


def find_cancel_guide(payee_name: str) -> CancelGuideMatch:
    payee_norm = normalize_payee(payee_name.strip())
    if not payee_norm:
        return CancelGuideMatch(matched=False)

    best_guide: Optional[dict[str, Any]] = None
    best_score = 0.0
    for g in list_guides():
        if not isinstance(g, dict):
            continue
        sc = _score_match(payee_norm, g)
        if sc > best_score:
            best_score = sc
            best_guide = g

    if best_guide is None or best_score < 0.5:
        return CancelGuideMatch(matched=False)

    ver = best_guide.get("verification") or "maintainer_curated"
    if ver not in ("official_docs", "maintainer_curated", "community"):
        ver = "maintainer_curated"

    steps = best_guide.get("steps") or []
    if not isinstance(steps, list):
        steps = []
    steps = [str(x) for x in steps if str(x).strip()]

    url = best_guide.get("verified_cancel_url")
    if url is not None and not isinstance(url, str):
        url = None
    if url == "":
        url = None

    return CancelGuideMatch(
        matched=True,
        merchant_key=str(best_guide.get("merchant_key") or ""),
        display_name=str(best_guide.get("display_name") or best_guide.get("merchant_key") or "Subscription"),
        verified_cancel_url=url,
        steps=steps,
        verification=ver,  # type: ignore[arg-type]
    )


def show_verified_link_badge(verification: Optional[str]) -> bool:
    """UI: only treat URL as 'verified' for official + maintainer rows."""
    return verification in ("official_docs", "maintainer_curated")
