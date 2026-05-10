"""Redact potentially sensitive content from log lines.

The cloud LLM route logs exception messages on failure (`logger.warning(...)`).
Some upstream libraries embed the full request body in their error reprs —
httpx's HTTPStatusError shows the request URL, headers, and (in some
versions) the body in `__str__`. If the request body contains the user's
prompt, that prompt would land in our log file.

Privacy contract from /privacy: "We don't log your requests." We enforce
that contract here.

This module is conservative: it strips anything that *looks* like prompt
content from a log string before it reaches the logger. Callers always pass
errors through ``safe_error_message`` before logging.
"""
from __future__ import annotations

import re
from typing import Optional


# Patterns we want to redact from log lines. Each is paired with a replacement
# token so a downstream operator can grep for "[redacted-XXX]" to estimate
# how often each path triggers without seeing the underlying value.
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # Common JSON-body shape: "prompt":"...", "system":"...", "message":"..."
    (re.compile(r'"(prompt|system|message|content|notes|memo)"\s*:\s*"(?:[^"\\]|\\.)*"', re.IGNORECASE),
     r'"\1":"[redacted-content]"'),
    # Bearer tokens / API keys
    (re.compile(r"(Bearer|Token)\s+[A-Za-z0-9_\-\.=]+", re.IGNORECASE), r"\1 [redacted-token]"),
    # SSNs (US): 3-2-4 with hyphens or spaces. Loose enough to catch obvious cases.
    (re.compile(r"\b\d{3}[ -]\d{2}[ -]\d{4}\b"), "[redacted-ssn]"),
    # Credit card numbers — Luhn-loose, just digit groups.
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[redacted-cc]"),
    # Email addresses are user identifiers, not content per se, but they're
    # PII. Redact in error messages — we never need them to debug an LLM call.
    (re.compile(r"\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b"), "[redacted-email]"),
)

# Hard cap on the redacted message length. Even after redaction, an exception
# repr can carry stack frames with file paths / locals. Truncating bounds the
# blast radius.
_MAX_LEN = 400


def safe_error_message(e: BaseException, *, prefix: Optional[str] = None) -> str:
    """Return a log-safe string describing an exception.

    Use this in place of `str(e)` / `repr(e)` whenever the exception might
    have been raised in a path that handled user content (LLM routes,
    cloud-proxy code, anything that touches `body.prompt`). Guarantees:

    1. Known PII patterns and request-body fields are redacted.
    2. The string is truncated to `_MAX_LEN` characters.
    3. The exception class name is preserved as the first token, so an
       operator can still grep for the failure type.
    """
    name = type(e).__name__
    raw = str(e)
    if not raw:
        return f"{prefix + ': ' if prefix else ''}{name}"
    redacted = raw
    for pat, repl in _PATTERNS:
        redacted = pat.sub(repl, redacted)
    if len(redacted) > _MAX_LEN:
        redacted = redacted[: _MAX_LEN - 3] + "..."
    return f"{prefix + ': ' if prefix else ''}{name}: {redacted}"


def redact(text: str) -> str:
    """Apply the same redactions to a plain string. Useful for log lines
    that aren't exception messages but still might contain user content."""
    out = text
    for pat, repl in _PATTERNS:
        out = pat.sub(repl, out)
    if len(out) > _MAX_LEN:
        out = out[: _MAX_LEN - 3] + "..."
    return out
