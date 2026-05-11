from __future__ import annotations

"""Email templates as Python functions, no Jinja dependency.

Each function returns ``(subject, text, html)``. Plain text comes first
because some mail clients strip HTML; the text version must stand alone.
"""

from typing import Tuple


def magic_link(
    *,
    sign_in_url: str,
    requesting_user_agent: str = "",
    ttl_minutes: int = 15,
) -> Tuple[str, str, str]:
    """Magic-link sign-in email.

    Args:
        sign_in_url: The fully-built URL the user clicks (already includes
            the token in a query param).
        requesting_user_agent: Optional UA string to display. Empty by
            default — we usually don't have it.
        ttl_minutes: For copy only; the actual expiry is enforced server-side.

    Privacy:
        We do NOT include the token in the email body's plain-text fallback
        as a copy-paste string — only as the clickable link. Reduces the
        chance a user pastes it somewhere unsafe.
    """
    subject = "Sign in to Clarity"

    text_parts = [
        "Sign in to Clarity",
        "",
        f"Click this link to sign in (expires in {ttl_minutes} minutes):",
        sign_in_url,
        "",
        "If you didn't request this, you can ignore this email.",
        "Your account is safe — clicking nothing means nothing changes.",
    ]
    if requesting_user_agent:
        text_parts += ["", f"Request from: {requesting_user_agent}"]
    text = "\n".join(text_parts)

    # Inline-styled HTML so it renders correctly in every mail client without
    # a <style> block (Gmail, Outlook, Apple Mail all handle this consistently).
    # No images, no remote resources — they get blocked by default and look broken.
    html = f"""
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;">
  <table cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
    <tr><td style="padding:32px 32px 24px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Sign in to Clarity</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444;">
        Click the button below to sign in. The link is valid for {ttl_minutes} minutes
        and can only be used once.
      </p>
      <p style="margin:0 0 28px;">
        <a href="{sign_in_url}"
           style="display:inline-block;padding:12px 24px;background:#111;color:#fff;
                  text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Sign in to Clarity
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#666;line-height:1.5;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:13px;color:#444;word-break:break-all;">
        <a href="{sign_in_url}" style="color:#0a66c2;">{sign_in_url}</a>
      </p>
      <hr style="border:0;border-top:1px solid #eee;margin:24px 0;">
      <p style="margin:0;font-size:12px;color:#888;line-height:1.5;">
        If you didn't request this, you can safely ignore this email.
        Your account stays as it was — clicking nothing means nothing changes.
      </p>
    </td></tr>
  </table>
</body>
</html>
""".strip()
    return subject, text, html
