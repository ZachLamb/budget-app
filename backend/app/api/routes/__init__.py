from fastapi import APIRouter
from app.api.routes import auth, accounts, payees, categories, transactions, rules, sync

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
router.include_router(payees.router, prefix="/payees", tags=["payees"])
router.include_router(categories.router, prefix="/categories", tags=["categories"])
router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
router.include_router(rules.router, prefix="/rules", tags=["rules"])
router.include_router(sync.router, prefix="/sync", tags=["sync"])
