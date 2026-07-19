"""Deterministic payee normalization + duplicate detection.

Bank descriptors arrive noisy — ``SQ *BLUE BOTTLE #4471``, ``TST* Blue Bottle``,
``Blue Bottle Coffee`` — and each variant becomes its own payee. This module
normalizes a raw descriptor to a comparison key and clusters payees that share
one, so the same merchant can be merged into a single payee.

Pure and side-effect-free for unit testing. Conservative on purpose: merging is
hard to undo, so we only cluster payees whose *normalized* names are identical
after light, well-understood cleaning — never fuzzy-similar ones. An optional
on-device LLM pass can later propose a nicer canonical display name, but the
clustering here needs no model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Common point-of-sale / processor prefixes that carry no merchant identity.
_PREFIX_RE = re.compile(
    r"^(sq \*|tst\*\s*|sp \*?|paypal \*|pp\*|ppd |pos |dd \*|ach |chkcard )",
    re.IGNORECASE,
)
# A trailing store/location number like "#4471" or "# 12".
_STORE_NUM_RE = re.compile(r"\s*#\s*\d+\s*$")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_payee_name(raw: str) -> str:
    """Reduce a raw payee/descriptor to a stable comparison key.

    Lowercases, strips a known POS/processor prefix, drops a trailing ``#number``
    store code, folds remaining punctuation to single spaces, and trims. Returns
    "" when nothing meaningful remains (caller should skip those).
    """
    if not raw:
        return ""
    s = raw.strip().casefold()
    s = _PREFIX_RE.sub("", s)
    s = _STORE_NUM_RE.sub("", s)
    s = _NON_ALNUM_RE.sub(" ", s)
    return s.strip()


@dataclass(frozen=True)
class PayeeView:
    id: str
    name: str


@dataclass(frozen=True)
class DuplicateCluster:
    normalized_key: str
    canonical_id: str
    canonical_name: str
    duplicate_ids: tuple[str, ...]  # members other than the canonical
    member_names: tuple[str, ...]  # all display names, canonical first


def _cleanliness(name: str) -> tuple[int, int, int, str]:
    """Sort key: cleaner names (fewer digits, fewer symbols, shorter) rank first."""
    digits = sum(c.isdigit() for c in name)
    symbols = sum(not c.isalnum() and not c.isspace() for c in name)
    return (digits, symbols, len(name), name.casefold())


def find_duplicate_clusters(
    payees: list[PayeeView],
    *,
    min_cluster: int = 2,
) -> list[DuplicateCluster]:
    """Group payees whose normalized names collide into merge candidates.

    Each returned cluster names the cleanest member as the canonical target and
    lists the rest as duplicates to fold in. Deterministic ordering: clusters by
    descending member count then key; members within a cluster by cleanliness.
    """
    groups: dict[str, list[PayeeView]] = {}
    for p in payees:
        key = normalize_payee_name(p.name)
        if not key:
            continue
        groups.setdefault(key, []).append(p)

    clusters: list[DuplicateCluster] = []
    for key, members in groups.items():
        if len(members) < min_cluster:
            continue
        ordered = sorted(members, key=lambda p: _cleanliness(p.name))
        canonical = ordered[0]
        clusters.append(
            DuplicateCluster(
                normalized_key=key,
                canonical_id=canonical.id,
                canonical_name=canonical.name,
                duplicate_ids=tuple(p.id for p in ordered[1:]),
                member_names=tuple(p.name for p in ordered),
            )
        )

    clusters.sort(key=lambda c: (len(c.member_names), c.normalized_key), reverse=True)
    return clusters
