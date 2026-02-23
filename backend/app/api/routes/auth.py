from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt
from passlib.context import CryptContext

from app.database import get_db
from app.config import get_settings
from app.models import User, Household, CategoryGroup, Category
from app.schemas.user import UserCreate, UserLogin, UserResponse, TokenResponse
from app.api.deps import ALGORITHM, get_current_user

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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


def _create_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=30)
    return jwt.encode({"sub": user_id, "exp": expire}, get_settings().secret_key, algorithm=ALGORITHM)


@router.post("/register", response_model=TokenResponse)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    household = Household(name=data.household_name)
    db.add(household)
    await db.flush()

    user = User(
        email=data.email,
        name=data.name,
        password_hash=pwd_context.hash(data.password),
        household_id=household.id,
        role="owner",
    )
    db.add(user)
    await db.flush()

    for sort_idx, (group_name, config) in enumerate(DEFAULT_CATEGORIES.items()):
        group = CategoryGroup(
            household_id=household.id,
            name=group_name,
            sort_order=sort_idx,
            is_income=config.get("is_income", False),
        )
        db.add(group)
        await db.flush()
        for cat_idx, cat_name in enumerate(config["cats"]):
            db.add(Category(group_id=group.id, name=cat_name, sort_order=cat_idx))

    token = _create_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not pwd_context.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = _create_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)
