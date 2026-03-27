"""Seed realistic demo data when DEMO_MODE=true.

Called once at startup from main.py lifespan. Idempotent — skips if the
demo user already exists.
"""
from __future__ import annotations

import logging
import random
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from passlib.context import CryptContext

from app.models import (
    Account,
    AccountSnapshot,
    AutoCategorizationRule,
    BudgetAssignment,
    Category,
    CategoryGroup,
    FinancialGoal,
    Household,
    ImportBatch,
    Payee,
    RecurringTransaction,
    SyncLog,
    Transaction,
    User,
)

logger = logging.getLogger(__name__)

DEMO_EMAIL = "demo@claritybudget.app"
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Category definitions (mirrors DEFAULT_CATEGORIES in auth.py) ────────────
DEFAULT_CATEGORIES = {
    "Income": {"is_income": True, "cats": ["Salary", "Freelance", "Interest", "Other Income"]},
    "Housing": {"cats": ["Rent/Mortgage", "Utilities", "Internet", "Home Maintenance"]},
    "Food & Drink": {"cats": ["Groceries", "Restaurants", "Coffee"]},
    "Transportation": {"cats": ["Gas", "Car Payment", "Car Insurance", "Public Transit", "Parking"]},
    "Personal": {"cats": ["Clothing", "Haircut", "Subscriptions", "Gym"]},
    "Health": {"cats": ["Medical", "Dental", "Pharmacy", "Vision"]},
    "Entertainment": {"cats": ["Streaming", "Events", "Hobbies", "Vacation"]},
    "Financial": {"cats": ["Savings", "Investments", "Debt Payments"]},
    "Giving": {"cats": ["Charity", "Gifts"]},
}


def _id() -> str:
    return str(uuid.uuid4())


def _date_range(start: date, end: date):
    """Yield each date from start to end inclusive."""
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


async def seed_demo_data(session_factory) -> None:
    """Populate the database with demo data. Idempotent."""
    async with session_factory() as db:
        existing = await db.execute(select(User).where(User.email == DEMO_EMAIL))
        if existing.scalar_one_or_none() is not None:
            logger.info("Demo data already seeded — skipping")
            return

    logger.info("Seeding demo data …")
    random.seed(42)
    today = date.today()

    async with session_factory() as db:
        # ── Household ──────────────────────────────────────────────
        household_id = _id()
        db.add(Household(
            id=household_id,
            name="Demo Household",
            simplefin_access_url="https://demo.simplefin.example/access",
            sync_interval_hours=4,
            ai_enabled=True,
            debt_strategy="avalanche",
            debt_extra_monthly=Decimal("200.00"),
        ))
        await db.flush()  # ensure household exists before FK references

        # ── User ───────────────────────────────────────────────────
        user_id = _id()
        db.add(User(
            id=user_id,
            email=DEMO_EMAIL,
            name="Alex Demo",
            password_hash=_pwd_context.hash("demo"),
            household_id=household_id,
            role="owner",
        ))
        await db.flush()  # ensure user + household exist

        # ── Categories ─────────────────────────────────────────────
        cat_lookup: dict[str, str] = {}  # category name → id
        sort_g = 0
        for group_name, info in DEFAULT_CATEGORIES.items():
            gid = _id()
            db.add(CategoryGroup(
                id=gid,
                household_id=household_id,
                name=group_name,
                sort_order=sort_g,
                is_income=info.get("is_income", False),
            ))
            sort_g += 1
            for idx, cat_name in enumerate(info["cats"]):
                cid = _id()
                cat_lookup[cat_name] = cid
                db.add(Category(id=cid, group_id=gid, name=cat_name, sort_order=idx))
        await db.flush()  # categories must exist before transactions reference them

        # ── Accounts ───────────────────────────────────────────────
        yesterday = datetime.now(timezone.utc) - timedelta(hours=18)

        acct_checking_id = _id()
        acct_savings_id = _id()
        acct_visa_id = _id()
        acct_loan_id = _id()
        acct_vacation_id = _id()

        accounts_data = [
            (acct_checking_id, "Main Checking", "checking", "First National Bank", True, None, None),
            (acct_savings_id, "Emergency Savings", "savings", "First National Bank", True, None, None),
            (acct_visa_id, "Chase Visa", "credit", "Chase", True, Decimal("21.9900"), Decimal("45.00")),
            (acct_loan_id, "Car Loan", "loan", "Credit Union", False, Decimal("4.5000"), Decimal("285.00")),
            (acct_vacation_id, "Vacation Fund", "savings", "Ally Bank", True, None, None),
        ]
        for aid, name, atype, inst, is_budget, rate, minpay in accounts_data:
            db.add(Account(
                id=aid,
                household_id=household_id,
                name=name,
                account_type=atype,
                institution=inst,
                is_budget_account=is_budget,
                simplefin_id=f"demo-{atype}-{aid[:8]}",
                interest_rate=rate,
                minimum_payment=minpay,
                sync_enabled=True,
                last_synced_at=yesterday,
            ))

        # ── Payees ─────────────────────────────────────────────────
        payee_names = [
            "Kroger", "Costco", "Amazon", "Target", "Starbucks", "Shell Gas",
            "Netflix", "Spotify", "Comcast", "Duke Energy", "State Farm",
            "Planet Fitness", "Walgreens", "Chipotle", "Home Depot", "Uber",
            "DoorDash", "T-Mobile", "Dr. Smith", "PetSmart", "Trader Joe's",
            "REI", "Apple", "Charity Water", "Employer",
        ]
        payee_lookup: dict[str, str] = {}
        for pname in payee_names:
            pid = _id()
            payee_lookup[pname] = pid
            db.add(Payee(id=pid, household_id=household_id, name=pname))

        # Flush accounts + payees so transactions can reference them
        await db.flush()

        # ── Helper: add transaction ────────────────────────────────
        all_transactions: list[Transaction] = []

        def _txn(acct_id: str, d: date, payee: str, amount: float, category: str, *, notes: str | None = None):
            t = Transaction(
                id=_id(),
                account_id=acct_id,
                date=d,
                payee_id=payee_lookup.get(payee),
                amount=Decimal(str(round(amount, 2))),
                category_id=cat_lookup.get(category),
                notes=notes,
                cleared=True,
                reconciled=False,
            )
            all_transactions.append(t)
            db.add(t)

        # ── Transactions (5 months back) ───────────────────────────
        months_back = 5
        first_day = today.replace(day=1) - timedelta(days=months_back * 30)
        first_day = first_day.replace(day=1)

        current = first_day
        while current <= today:
            y, m = current.year, current.month

            # --- Income: salary on 1st and 15th ---
            for pay_day in [1, 15]:
                d = date(y, m, pay_day)
                if first_day <= d <= today:
                    _txn(acct_checking_id, d, "Employer", 4800.00, "Salary")

            # --- Rent on 1st ---
            d = date(y, m, 1)
            if first_day <= d <= today:
                _txn(acct_checking_id, d, "Home Depot", -1650.00, "Rent/Mortgage", notes="Monthly rent")

            # --- Utilities ---
            for d_off, payee, cat, lo, hi in [
                (3, "Comcast", "Internet", -85, -95),
                (5, "Duke Energy", "Utilities", -95, -145),
                (7, "T-Mobile", "Internet", -85, -85),
            ]:
                d = date(y, m, min(d_off, 28))
                if first_day <= d <= today:
                    _txn(acct_checking_id, d, payee, random.uniform(lo, hi), cat)

            # --- Subscriptions ---
            for d_off, payee, amt, cat in [
                (2, "Netflix", -15.99, "Streaming"),
                (2, "Spotify", -10.99, "Subscriptions"),
                (10, "Planet Fitness", -24.99, "Gym"),
            ]:
                d = date(y, m, min(d_off, 28))
                if first_day <= d <= today:
                    _txn(acct_checking_id, d, payee, amt, cat)

            # --- Insurance ---
            d = date(y, m, 12)
            if first_day <= d <= today:
                _txn(acct_checking_id, d, "State Farm", -142.00, "Car Insurance")

            # --- Car payment ---
            d = date(y, m, 15)
            if first_day <= d <= today:
                _txn(acct_checking_id, d, "Credit Union", -285.00, "Car Payment",
                     notes="Auto loan payment")
                # Corresponding credit on the loan account
                _txn(acct_loan_id, d, "Credit Union", 285.00, "Debt Payments")

            # --- Groceries: 4-6 per month ---
            for _ in range(random.randint(4, 6)):
                d = date(y, m, random.randint(1, min(28, (date(y, m + 1, 1) - timedelta(days=1)).day if m < 12 else 31)))
                if first_day <= d <= today:
                    payee = random.choice(["Kroger", "Costco", "Trader Joe's"])
                    _txn(acct_checking_id, d, payee, round(random.uniform(-40, -180), 2), "Groceries")

            # --- Restaurants: 3-5 per month ---
            for _ in range(random.randint(3, 5)):
                d = date(y, m, random.randint(1, 28))
                if first_day <= d <= today:
                    payee = random.choice(["Chipotle", "DoorDash", "Starbucks"])
                    cat = "Coffee" if payee == "Starbucks" else "Restaurants"
                    _txn(acct_checking_id, d, payee, round(random.uniform(-12, -65), 2), cat)

            # --- Gas: 2-3 per month ---
            for _ in range(random.randint(2, 3)):
                d = date(y, m, random.randint(1, 28))
                if first_day <= d <= today:
                    _txn(acct_checking_id, d, "Shell Gas", round(random.uniform(-35, -58), 2), "Gas")

            # --- Shopping: occasional Amazon/Target ---
            if random.random() < 0.6:
                d = date(y, m, random.randint(5, 25))
                if first_day <= d <= today:
                    payee = random.choice(["Amazon", "Target"])
                    _txn(acct_checking_id, d, payee, round(random.uniform(-20, -150), 2), "Clothing")

            # --- Medical: occasional ---
            if random.random() < 0.3:
                d = date(y, m, random.randint(1, 28))
                if first_day <= d <= today:
                    _txn(acct_checking_id, d, "Dr. Smith", round(random.uniform(-25, -200), 2), "Medical")

            # --- Transfers to savings (20th of each month) ---
            d = date(y, m, 20)
            if first_day <= d <= today:
                _txn(acct_checking_id, d, "Emergency Savings", -300.00, "Savings",
                     notes="Monthly savings transfer")
                _txn(acct_savings_id, d, "Main Checking", 300.00, "Savings")

                _txn(acct_checking_id, d, "Vacation Fund", -150.00, "Savings",
                     notes="Vacation fund transfer")
                _txn(acct_vacation_id, d, "Main Checking", 150.00, "Savings")

            # --- Credit card spending (a few charges per month) ---
            for _ in range(random.randint(2, 4)):
                d = date(y, m, random.randint(1, 28))
                if first_day <= d <= today:
                    payee = random.choice(["Amazon", "Target", "Uber", "REI"])
                    _txn(acct_visa_id, d, payee, round(random.uniform(-15, -120), 2),
                         random.choice(["Clothing", "Hobbies", "Events"]))

            # --- Charity: once a month ---
            d = date(y, m, 25)
            if first_day <= d <= today:
                _txn(acct_checking_id, d, "Charity Water", -25.00, "Charity")

            # Advance to next month
            if m == 12:
                current = date(y + 1, 1, 1)
            else:
                current = date(y, m + 1, 1)

        # ── Budget Assignments (current month + 2 prior) ──────────
        budget_plan = {
            "Rent/Mortgage": 1650, "Utilities": 140, "Internet": 90,
            "Groceries": 600, "Restaurants": 200, "Coffee": 40,
            "Gas": 150, "Car Payment": 285, "Car Insurance": 142,
            "Subscriptions": 50, "Streaming": 16, "Gym": 25,
            "Medical": 100, "Savings": 450, "Charity": 25,
            "Clothing": 100, "Hobbies": 75, "Debt Payments": 200,
        }
        for months_ago in range(3):
            m_date = today.replace(day=1) - timedelta(days=months_ago * 30)
            month_str = m_date.strftime("%Y-%m")
            for cat_name, amount in budget_plan.items():
                if cat_name in cat_lookup:
                    db.add(BudgetAssignment(
                        id=_id(),
                        household_id=household_id,
                        category_id=cat_lookup[cat_name],
                        month=month_str,
                        assigned_amount=Decimal(str(amount)),
                    ))

        # ── Financial Goals ────────────────────────────────────────
        db.add(FinancialGoal(
            id=_id(), household_id=household_id,
            name="Emergency Fund",
            description="6 months of expenses",
            goal_type="emergency_fund",
            target_amount=Decimal("15000.00"),
            current_amount=Decimal("8150.00"),
            monthly_contribution=Decimal("300.00"),
            account_id=acct_savings_id,
            sort_order=0,
        ))
        db.add(FinancialGoal(
            id=_id(), household_id=household_id,
            name="Pay Off Chase Visa",
            description="Eliminate credit card debt",
            goal_type="debt_payoff",
            target_amount=Decimal("2340.00"),
            current_amount=Decimal("0.00"),
            monthly_contribution=Decimal("200.00"),
            account_id=acct_visa_id,
            sort_order=1,
        ))
        db.add(FinancialGoal(
            id=_id(), household_id=household_id,
            name="Beach Vacation",
            description="Summer trip to the coast",
            goal_type="savings",
            target_amount=Decimal("3000.00"),
            current_amount=Decimal("1420.00"),
            monthly_contribution=Decimal("150.00"),
            target_date=today + timedelta(days=180),
            account_id=acct_vacation_id,
            sort_order=2,
        ))

        # ── Recurring Transactions ─────────────────────────────────
        def _next_occurrence(day: int) -> date:
            """Return the next occurrence of the given day-of-month."""
            candidate = today.replace(day=min(day, 28))
            if candidate <= today:
                m = candidate.month + 1
                y = candidate.year + (1 if m > 12 else 0)
                m = m if m <= 12 else m - 12
                candidate = date(y, m, min(day, 28))
            return candidate

        recurring_items = [
            ("Home Depot", -1650.00, "Rent/Mortgage", acct_checking_id, 1, False),
            ("Comcast", -89.00, "Internet", acct_checking_id, 3, True),
            ("Duke Energy", -120.00, "Utilities", acct_checking_id, 5, True),
            ("Netflix", -15.99, "Streaming", acct_checking_id, 2, True),
            ("Spotify", -10.99, "Subscriptions", acct_checking_id, 2, True),
            ("Planet Fitness", -24.99, "Gym", acct_checking_id, 10, True),
            ("T-Mobile", -85.00, "Internet", acct_checking_id, 7, True),
        ]
        for pname, amt, cat, acct, day, is_sub in recurring_items:
            db.add(RecurringTransaction(
                id=_id(), household_id=household_id,
                payee_id=payee_lookup[pname],
                amount=Decimal(str(amt)),
                category_id=cat_lookup[cat],
                frequency="monthly",
                next_date=_next_occurrence(day),
                account_id=acct,
                is_subscription=is_sub,
            ))

        # ── Auto-categorization Rules ──────────────────────────────
        rules = [
            ("Kroger", "Groceries"), ("Shell", "Gas"),
            ("Netflix", "Streaming"), ("Starbucks", "Coffee"),
        ]
        for match_val, cat_name in rules:
            db.add(AutoCategorizationRule(
                id=_id(), household_id=household_id,
                priority=0,
                match_field="payee",
                match_type="contains",
                match_value=match_val,
                category_id=cat_lookup[cat_name],
                source="manual",
                enabled=True,
            ))

        # ── Account Snapshots (90 days for checking) ───────────────
        balance = Decimal("2400.00")
        for d in _date_range(today - timedelta(days=90), today):
            # Simulate a balance curve: bumps on paydays, dips mid-month
            if d.day in (1, 15):
                balance += Decimal("4800.00")
            if d.day == 1:
                balance -= Decimal("1650.00")  # rent
            daily_spend = Decimal(str(round(random.uniform(20, 120), 2)))
            balance -= daily_spend
            if balance < Decimal("500"):
                balance = Decimal("500.00")
            db.add(AccountSnapshot(
                id=_id(), account_id=acct_checking_id, date=d,
                balance=balance.quantize(Decimal("0.01")),
            ))

        # ── Sync Logs (a few successful past syncs) ────────────────
        for days_ago in [14, 7, 3, 1]:
            started = datetime.now(timezone.utc) - timedelta(days=days_ago)
            db.add(SyncLog(
                id=_id(), household_id=household_id,
                provider="simplefin",
                status="success",
                accounts_synced=5,
                transactions_imported=random.randint(8, 25),
                started_at=started,
                completed_at=started + timedelta(seconds=random.randint(3, 12)),
            ))

        # ── Import Batch (for the sync logs to reference) ──────────
        db.add(ImportBatch(
            id=_id(), account_id=acct_checking_id,
            source="simplefin", filename=None,
            transaction_count=len(all_transactions),
        ))

        await db.commit()

    logger.info("Demo data seeded: %d transactions across 5 accounts", len(all_transactions))
