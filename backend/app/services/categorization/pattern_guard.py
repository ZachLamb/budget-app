"""Bounds on the patterns a rule may carry.

A `regex` rule is user-supplied code that the server runs against every
uncategorized transaction. Two things follow.

First, a pattern that does not compile must be refused at write time. The
matcher skips one it cannot compile, so without this check a typo becomes
a rule that silently matches nothing forever -- the worst kind of bug,
because the screen says the rule is on.

Second, catastrophic backtracking. Nested quantifiers like `(a+)+$` take
time exponential in the length of the subject, so a single short pattern
can occupy a worker indefinitely. Python's `re` has no timeout and no way
to cancel a match in progress, so the only defence available without a
new dependency is to refuse the shapes that cause it.

This is a filter, not a proof. It rejects the classic nested-quantifier
forms; it cannot certify that everything it admits is linear. The real
bound is that patterns are household-scoped and capped in length -- the
person who writes a slow one is the person it slows down.
"""

from __future__ import annotations

import re

#: Long enough for any payee pattern anyone actually writes, short enough
#: that the search space stays small.
MAX_MATCH_VALUE = 200

#: A quantifier, in any of its spellings.
_QUANT = r"(?:[+*]|\{\d*,\d*\})"

#: A quantifier applied to a group whose contents are themselves
#: quantified -- `(a+)+`, `(a*)*`, `(\d+|x)+`, `(?:ab+)*`, `(x{1,}){2,}`.
#: The engine can split the subject between the inner and outer repeat in
#: exponentially many ways.
_NESTED_QUANTIFIER = re.compile(rf"\([^()]*{_QUANT}[^()]*\)\s*{_QUANT}")

#: `\+` is a literal plus, not a repeat. Dropping escape pairs before the
#: scan keeps `(a\+b)+` out of the net while leaving `(\d+)+` in it.
_ESCAPED = re.compile(r"\\.")


class BadPattern(ValueError):
    """The pattern cannot be stored, with a reason worth showing a user."""


def check_match_value(match_type: str, value: str) -> None:
    """Raise `BadPattern` if this rule could not work, or could not stop."""
    if not value.strip():
        raise BadPattern("Give something to match on.")
    if len(value) > MAX_MATCH_VALUE:
        raise BadPattern(
            f"Keep the match value under {MAX_MATCH_VALUE} characters."
        )
    if match_type != "regex":
        return

    try:
        re.compile(value)
    except re.error as exc:
        # The engine's own message points at the offending character,
        # which is more use than "invalid pattern".
        raise BadPattern(f"That is not a valid regular expression: {exc}") from exc

    if _NESTED_QUANTIFIER.search(_ESCAPED.sub("", value)):
        raise BadPattern(
            "That pattern repeats a group that already repeats "
            "(like `(a+)+`), which can take effectively forever to match. "
            "Rewrite it without the nested repeat."
        )
