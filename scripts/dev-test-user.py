#!/usr/bin/env python3
"""Create and destroy throwaway local test users for the budget app.

Driving the real UI needs a real account with real rows behind it. Making
one by hand takes a registration call, a status flip in the database, and
a dozen seeding requests; removing one means deleting from eighteen
tables in the right order. This does both.

    scripts/dev-test-user.py create              # full household, tax data and all
    scripts/dev-test-user.py create --profile empty   # nothing set up: first-run UX
    scripts/dev-test-user.py list
    scripts/dev-test-user.py destroy --email uitest@local.test
    scripts/dev-test-user.py destroy --all

Two guards, because destroy deletes households:

1. Every address it touches must end in `@local.test`. A real account
   cannot be named, so it cannot be deleted.
2. The database must be on localhost. Pointed at Neon, it refuses.

Needs the backend running (default http://localhost:8001) and the backend
virtualenv, which supplies SQLAlchemy:

    cd backend && source .venv/bin/activate && cd ..
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
TEST_DOMAIN = "@local.test"
DEFAULT_API = os.environ.get("DEV_TEST_USER_API", "http://localhost:8001/api")
DEFAULT_PASSWORD = os.environ.get("DEV_TEST_USER_PASSWORD", "LocalUiTest!2026")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}

# Tables holding rows that belong to a household or a user, in the order
# they have to be deleted. Anything reachable only through another row
# (transactions via accounts, categories via category_groups) is handled
# by the matching subquery below.
HOUSEHOLD_TABLES = [
    "budget_assignments", "auto_categorization_rules", "recurring_transactions",
    "recurring_suggestion_dismissals", "fsa_review_items", "financial_goals",
    "cycle_commitments", "sync_log", "payees", "paystubs", "prior_year_returns",
    "tax_profiles",
]
USER_TABLES = ["llm_audit", "llm_consent", "magic_links", "webauthn_credentials"]


def die(message: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def check_email(email: str) -> str:
    if not email.endswith(TEST_DOMAIN):
        die(f"refusing to touch {email!r}: test accounts must end in {TEST_DOMAIN}")
    return email


def sync_database_url() -> str:
    """Read DATABASE_URL_SYNC out of backend/.env, and refuse anything remote."""
    env_file = REPO / "backend" / ".env"
    url = os.environ.get("DATABASE_URL_SYNC")
    if not url and env_file.exists():
        for line in env_file.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "DATABASE_URL_SYNC":
                url = value.strip().strip('"').strip("'")
                break
    if not url:
        die("no DATABASE_URL_SYNC in environment or backend/.env")

    host = urlparse(url).hostname or ""
    if host not in LOCAL_HOSTS:
        die(
            f"refusing to run against {host!r}. This script deletes households; "
            "it only ever runs on a local database."
        )
    return url


def engine():
    try:
        from sqlalchemy import create_engine
    except ModuleNotFoundError:
        die("SQLAlchemy not importable — activate the backend venv first "
            "(cd backend && source .venv/bin/activate && cd ..)")
    return create_engine(sync_database_url(), future=True)


class Api:
    """Cookie-session client. The app issues an HttpOnly session cookie and
    returns access_token: null, so a bearer token is not an option."""

    def __init__(self, base: str, origin: str) -> None:
        self.base = base.rstrip("/")
        # State-changing routes check the Origin header (the app's CSRF
        # defence), so a plain scripted POST is rejected without it.
        self.origin = origin.rstrip("/")
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def call(self, method: str, path: str, body: dict | None = None,
             allow: tuple[int, ...] = ()):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={
                "Content-Type": "application/json",
                "Origin": self.origin,
                "Referer": f"{self.origin}/",
            },
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            if exc.code in allow:
                return None
            detail = exc.read().decode()[:300]
            die(f"{method} {path} -> {exc.code}: {detail}")
        except urllib.error.URLError as exc:
            die(f"cannot reach {self.base} ({exc.reason}). Is the backend running?")


def approve(email: str) -> None:
    from sqlalchemy import text
    with engine().begin() as conn:
        updated = conn.execute(
            text("UPDATE users SET status='approved' WHERE email=:e"), {"e": email}
        ).rowcount
    if not updated:
        die(f"{email} was not registered, so it cannot be approved")


def set_pay_frequency(email: str, frequency: str, last_pay: str) -> None:
    from sqlalchemy import text
    with engine().begin() as conn:
        conn.execute(
            text(
                "UPDATE households SET pay_frequency=:f, pay_last_confirmed_date=:d "
                "WHERE id = (SELECT household_id FROM users WHERE email=:e)"
            ),
            {"f": frequency, "d": last_pay, "e": email},
        )


def seed(api: Api, year: int) -> None:
    """A household that exercises the tax surface: both deduction kinds, a
    paystub with year-to-date figures, and last year's return."""
    account = api.call("POST", "/accounts", {
        "name": "Checking", "account_type": "checking", "starting_balance": "5000.00",
    })
    rental = api.call("POST", "/categories/groups", {"name": "Rental"})
    personal = api.call("POST", "/categories/groups", {"name": "Personal"})

    categories = {}
    for group_id, name, kind, line in [
        (rental["id"], "Cleaning", "business_expense", "Schedule E — Cleaning"),
        (rental["id"], "Repairs", "business_expense", "Schedule E — Repairs"),
        (personal["id"], "Medical", "personal_itemized", "Schedule A — Medical"),
        (personal["id"], "Groceries", None, None),
    ]:
        category = api.call("POST", "/categories", {"group_id": group_id, "name": name})
        if kind:
            category = api.call("PUT", f"/categories/{category['id']}", {
                "deductible": True, "deduction_pct": 100,
                "tax_line": line, "deduction_kind": kind,
            })
        categories[name] = category

    for name, amount, month, day in [
        ("Cleaning", "-1240.00", 3, 5), ("Repairs", "-860.50", 5, 12),
        ("Medical", "-3200.00", 7, 19), ("Groceries", "-410.25", 8, 22),
    ]:
        api.call("POST", "/transactions", {
            "account_id": account["id"], "date": f"{year}-{month:02d}-{day:02d}",
            "payee_name": f"{name} vendor", "amount": amount,
            "category_id": categories[name]["id"], "cleared": True,
        })

    api.call("PUT", "/tax/profile", {
        "filing_status": "single",
        "walkthrough_answers": {"married": False, "supports_dependent": False},
    })
    api.call("POST", "/tax/paystubs", {
        "pay_date": f"{year}-09-15",
        "gross": "6884.62", "pretax_401k": "550.00", "pretax_hsa": "150.00",
        "federal_withheld": "1150.00", "state_withheld": "290.00",
        "ss_withheld": "417.00", "medicare_withheld": "97.55",
        "gross_ytd": "124000.00", "pretax_401k_ytd": "9900.00",
        "pretax_hsa_ytd": "2700.00", "federal_withheld_ytd": "20700.00",
        "state_withheld_ytd": "5220.00", "ss_withheld_ytd": "7506.00",
        "medicare_withheld_ytd": "1755.90",
    })
    api.call("PUT", f"/tax/prior-year/{year - 1}", {
        "filing_status": "single", "agi": "158000.00", "taxable_income": "143000.00",
        "total_tax": "27400.00", "total_withheld": "26900.00", "itemized": False,
        "schedule_e_net": "-4200.00",
    })


def cmd_create(args: argparse.Namespace) -> None:
    email = check_email(args.email)
    sync_database_url()
    api = Api(args.api, args.app)

    # Registration answers 403 "awaiting approval" on success: the row is
    # written, the admin gate just will not let it sign in yet. That is the
    # normal path here, not a failure.
    api.call(
        "POST", "/auth/register",
        {"email": email, "password": args.password, "name": "Local Test User"},
        allow=(403,),
    )
    approve(email)
    api.call("POST", "/auth/login", {"email": email, "password": args.password})

    year = args.year or dt.date.today().year
    if args.profile == "full":
        seed(api, year)
        set_pay_frequency(email, "biweekly", f"{year}-09-15")

    print(f"created {email}")
    print(f"  password: {args.password}")
    print(f"  profile:  {args.profile}"
          + ("  (categories, transactions, paystub, prior year, biweekly pay)"
             if args.profile == "full" else "  (nothing set up — first-run UX)"))
    print(f"  sign in:  {args.app}/login")


def find_users(emails: list[str] | None):
    from sqlalchemy import text
    query = "SELECT id, email, household_id FROM users WHERE email LIKE :pattern"
    params: dict[str, object] = {"pattern": f"%{TEST_DOMAIN}"}
    if emails:
        query += " AND email = ANY(:emails)"
        params["emails"] = emails
    with engine().connect() as conn:
        return list(conn.execute(text(query), params))


def cmd_list(args: argparse.Namespace) -> None:
    rows = find_users(None)
    if not rows:
        print(f"no {TEST_DOMAIN} users")
        return
    for row in rows:
        print(f"{row.email}  household={row.household_id}")


def cmd_destroy(args: argparse.Namespace) -> None:
    from sqlalchemy import text
    sync_database_url()
    emails = None if args.all else [check_email(args.email)]
    rows = find_users(emails)
    if not rows:
        print("nothing to destroy")
        return

    user_ids = [r.id for r in rows]
    household_ids = [r.household_id for r in rows]

    with engine().begin() as conn:
        for table in USER_TABLES:
            conn.execute(text(f"DELETE FROM {table} WHERE user_id = ANY(:ids)"),
                         {"ids": user_ids})
        conn.execute(
            text("DELETE FROM transactions WHERE account_id IN "
                 "(SELECT id FROM accounts WHERE household_id = ANY(:ids))"),
            {"ids": household_ids},
        )
        for table in HOUSEHOLD_TABLES:
            conn.execute(text(f"DELETE FROM {table} WHERE household_id = ANY(:ids)"),
                         {"ids": household_ids})
        conn.execute(
            text("DELETE FROM categories WHERE group_id IN "
                 "(SELECT id FROM category_groups WHERE household_id = ANY(:ids))"),
            {"ids": household_ids},
        )
        conn.execute(text("DELETE FROM category_groups WHERE household_id = ANY(:ids)"),
                     {"ids": household_ids})
        conn.execute(text("DELETE FROM accounts WHERE household_id = ANY(:ids)"),
                     {"ids": household_ids})
        conn.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": user_ids})
        conn.execute(text("DELETE FROM households WHERE id = ANY(:ids)"),
                     {"ids": household_ids})

    for row in rows:
        print(f"destroyed {row.email}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--api", default=DEFAULT_API, help=f"default {DEFAULT_API}")
    parser.add_argument("--app", default="http://localhost:3000",
                        help="frontend URL, printed for convenience")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="register, approve and optionally seed")
    create.add_argument("--email", default=f"uitest{TEST_DOMAIN}")
    create.add_argument("--password", default=DEFAULT_PASSWORD)
    create.add_argument("--profile", choices=["full", "empty"], default="full")
    create.add_argument("--year", type=int, help="tax year to seed (default: this year)")
    create.set_defaults(func=cmd_create)

    listing = sub.add_parser("list", help=f"show every {TEST_DOMAIN} user")
    listing.set_defaults(func=cmd_list)

    destroy = sub.add_parser("destroy", help="delete a test user and everything it owns")
    destroy.add_argument("--email", default=f"uitest{TEST_DOMAIN}")
    destroy.add_argument("--all", action="store_true",
                         help=f"destroy every {TEST_DOMAIN} user")
    destroy.set_defaults(func=cmd_destroy)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
