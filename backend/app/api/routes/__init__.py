from fastapi import APIRouter
from app.api.routes import (
    auth, accounts, payees, categories, transactions,
    rules, sync, budget, recurring, reports, categorization,
    goals, debt, ai, settings, subscriptions, cycle_commitments,
)

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
router.include_router(payees.router, prefix="/payees", tags=["payees"])
router.include_router(categories.router, prefix="/categories", tags=["categories"])
router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
router.include_router(rules.router, prefix="/rules", tags=["rules"])
router.include_router(sync.router, prefix="/sync", tags=["sync"])
router.include_router(budget.router, prefix="/budget", tags=["budget"])
router.include_router(recurring.router, prefix="/recurring", tags=["recurring"])
router.include_router(reports.router, prefix="/reports", tags=["reports"])
router.include_router(categorization.router, prefix="/categorization", tags=["categorization"])
router.include_router(goals.router, prefix="/goals", tags=["goals"])
router.include_router(debt.router, prefix="/debt", tags=["debt"])
router.include_router(ai.router, prefix="/ai", tags=["ai"])
router.include_router(settings.router, prefix="/settings", tags=["settings"])
router.include_router(subscriptions.router, prefix="/subscriptions", tags=["subscriptions"])
router.include_router(cycle_commitments.router, prefix="/cycle-commitments", tags=["cycle-commitments"])
