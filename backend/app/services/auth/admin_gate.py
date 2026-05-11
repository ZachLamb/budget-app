"""Admin bootstrap + approval gate for the login paths.

Two helpers:

- ``apply_admin_bootstrap(user)`` — idempotent promote-to-admin. If the
  user's email matches settings.admin_email (case-insensitive), bump them
  to role="admin" + status="approved". Self-healing: works for users that
  existed before the feature was deployed (next login promotes them) and
  for users created after (registration sets status=pending, then this
  promotes the admin one).

- ``check_approved(user)`` — raises 403 if the user is not in the
  "approved" state. Pending users see a clear "awaiting approval" message;
  rejected users see a "denied" message. Both are the same status code
  so the frontend can distinguish via the detail string if needed but the
  HTTP layer treats them identically.

Both helpers are called from every login path (password / passkey /
Google / magic-link) — bootstrap first, then gate. The caller is
responsible for committing if bootstrap returned True (i.e. modified
the row).
"""
from __future__ import annotations

from fastapi import HTTPException, status

from app.config import get_settings
from app.models.user import User


def apply_admin_bootstrap(user: User) -> bool:
    """Promote user to role="admin" + status="approved" if their email
    matches the configured ADMIN_EMAIL. Returns True if any field changed
    (caller must commit). No-op if ADMIN_EMAIL is unset or doesn't match.

    Comparison is lowercase on both sides. Caller passes a User instance
    that's already attached to a session — we mutate in place.
    """
    admin_email = (get_settings().admin_email or "").lower().strip()
    if not admin_email:
        return False
    if (user.email or "").lower().strip() != admin_email:
        return False
    changed = False
    if user.role != "admin":
        user.role = "admin"
        changed = True
    if user.status != "approved":
        user.status = "approved"
        changed = True
    return changed


def check_approved(user: User) -> None:
    """Raise 403 if the user is not approved. Call AFTER apply_admin_bootstrap
    so the admin's auto-promotion takes effect before the gate fires."""
    if user.status == "approved":
        return
    if user.status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been denied access. Contact the administrator.",
        )
    # Default branch covers "pending" and any unknown state. Same response
    # so adding new states later doesn't accidentally bypass the gate.
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Your account is awaiting approval by an administrator. You'll be able to sign in once it's approved.",
    )
