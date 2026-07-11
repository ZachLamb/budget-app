import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update as sql_update
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.api.deps import get_household_id
from app.services.realtime import emit_event
from app.models import (
    AutoCategorizationRule,
    BudgetAssignment,
    Category,
    CategoryGroup,
    Payee,
    RecurringTransaction,
    Transaction,
)
from app.schemas.category import (
    CategoryGroupCreate, CategoryGroupUpdate, CategoryGroupResponse,
    CategoryCreate, CategoryUpdate, CategoryResponse, CategoryUsageResponse,
    GroupOrderUpdate, CategoryOrderUpdate,
)

router = APIRouter()


@router.get("/groups", response_model=list[CategoryGroupResponse])
async def list_category_groups(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup)
        .where(CategoryGroup.household_id == household_id)
        .options(selectinload(CategoryGroup.categories))
        .order_by(CategoryGroup.sort_order, CategoryGroup.created_at)
    )
    return [CategoryGroupResponse.model_validate(g) for g in result.scalars().all()]


async def _usage_counts(db: AsyncSession, category_ids: list[str]) -> dict[str, CategoryUsageResponse]:
    """Per-category reference counts across everything that points at a category."""
    usage = {cid: CategoryUsageResponse() for cid in category_ids}
    if not category_ids:
        return usage
    sources = (
        ("transactions", Transaction.category_id),
        ("budget_entries", BudgetAssignment.category_id),
        ("rules", AutoCategorizationRule.category_id),
        ("payees", Payee.default_category_id),
        ("recurring", RecurringTransaction.category_id),
    )
    for field, column in sources:
        result = await db.execute(
            select(column, func.count()).where(column.in_(category_ids)).group_by(column)
        )
        for cid, count in result.all():
            setattr(usage[cid], field, count)
    return usage


_BLOCKER_LABELS = (
    ("budget_entries", "budget entry", "budget entries"),
    ("rules", "rule", "rules"),
    ("payees", "payee default", "payee defaults"),
    ("recurring", "recurring item", "recurring items"),
)


def _blocker_phrases(usage: CategoryUsageResponse) -> list[str]:
    phrases = []
    for field, singular, plural in _BLOCKER_LABELS:
        count = getattr(usage, field)
        if count:
            phrases.append(f"{count} {singular if count == 1 else plural}")
    return phrases


@router.get("/usage", response_model=dict[str, CategoryUsageResponse])
async def category_usage(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
    )
    return await _usage_counts(db, [row[0] for row in result.all()])


@router.put("/groups/order", status_code=204)
async def reorder_groups(
    data: GroupOrderUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CategoryGroup).where(CategoryGroup.household_id == household_id))
    groups = {g.id: g for g in result.scalars().all()}
    if sorted(data.ordered_ids) != sorted(groups):
        raise HTTPException(status_code=400, detail="ordered_ids must contain every group id exactly once")
    for index, gid in enumerate(data.ordered_ids):
        groups[gid].sort_order = index


@router.put("/order", status_code=204)
async def reorder_categories(
    data: CategoryOrderUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.id == data.group_id, CategoryGroup.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Category group not found")
    result = await db.execute(select(Category).where(Category.group_id == data.group_id))
    categories = {c.id: c for c in result.scalars().all()}
    if sorted(data.ordered_ids) != sorted(categories):
        raise HTTPException(status_code=400, detail="ordered_ids must contain every category id in the group exactly once")
    for index, cid in enumerate(data.ordered_ids):
        categories[cid].sort_order = index


@router.post("/groups", response_model=CategoryGroupResponse, status_code=201)
async def create_category_group(
    data: CategoryGroupCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    if payload.get("sort_order") is None:
        result = await db.execute(
            select(func.max(CategoryGroup.sort_order)).where(CategoryGroup.household_id == household_id)
        )
        max_sort = result.scalar()
        payload["sort_order"] = 0 if max_sort is None else max_sort + 1
    group = CategoryGroup(household_id=household_id, **payload)
    db.add(group)
    await db.flush()
    # Fresh object post-flush: async lazy-load of .categories would raise MissingGreenlet during serialization; refresh loads the (empty) collection.
    await db.refresh(group, ["categories"])
    asyncio.create_task(emit_event(household_id, "category.updated"))
    return CategoryGroupResponse.model_validate(group)


@router.put("/groups/{group_id}", response_model=CategoryGroupResponse)
async def update_category_group(
    group_id: str,
    data: CategoryGroupUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup)
        .where(CategoryGroup.id == group_id, CategoryGroup.household_id == household_id)
        .options(selectinload(CategoryGroup.categories))
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Category group not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    asyncio.create_task(emit_event(household_id, "category.updated"))
    return CategoryGroupResponse.model_validate(group)


@router.delete("/groups/{group_id}", status_code=204)
async def delete_category_group(
    group_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.id == group_id, CategoryGroup.household_id == household_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Category group not found")

    result = await db.execute(select(Category).where(Category.group_id == group_id))
    categories = result.scalars().all()
    usage = await _usage_counts(db, [c.id for c in categories])
    blocked = []
    for category in categories:
        phrases = _blocker_phrases(usage[category.id])
        if phrases:
            blocked.append(f"'{category.name}' is used by {' and '.join(phrases)}")
    if blocked:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete group '{group.name}': {'; '.join(blocked)}. Remove those first.",
        )
    category_ids = [c.id for c in categories]
    if category_ids:
        await db.execute(
            sql_update(Transaction).where(Transaction.category_id.in_(category_ids)).values(category_id=None)
        )
        for category in categories:
            await db.delete(category)
    await db.delete(group)
    asyncio.create_task(emit_event(household_id, "category.updated"))


@router.post("", response_model=CategoryResponse, status_code=201)
async def create_category(
    data: CategoryCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.id == data.group_id, CategoryGroup.household_id == household_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Category group not found")

    payload = data.model_dump()
    if payload.get("sort_order") is None:
        result = await db.execute(
            select(func.max(Category.sort_order)).where(Category.group_id == data.group_id)
        )
        max_sort = result.scalar()
        payload["sort_order"] = 0 if max_sort is None else max_sort + 1
    category = Category(**payload)
    db.add(category)
    await db.flush()
    asyncio.create_task(emit_event(household_id, "category.updated"))
    return CategoryResponse.model_validate(category)


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: str,
    data: CategoryUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(Category.id == category_id, CategoryGroup.household_id == household_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    updates = data.model_dump(exclude_unset=True)
    if "group_id" in updates and updates["group_id"]:
        grp_result = await db.execute(
            select(CategoryGroup).where(
                CategoryGroup.id == updates["group_id"],
                CategoryGroup.household_id == household_id,
            )
        )
        if not grp_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Category group not found")
    for field, value in updates.items():
        setattr(category, field, value)
    asyncio.create_task(emit_event(household_id, "category.updated"))
    return CategoryResponse.model_validate(category)


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Category)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(Category.id == category_id, CategoryGroup.household_id == household_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    usage = (await _usage_counts(db, [category_id]))[category_id]
    phrases = _blocker_phrases(usage)
    if phrases:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{category.name}': used by {' and '.join(phrases)}. Remove those first.",
        )
    # Transactions may reference the category; uncategorize them instead of failing.
    await db.execute(
        sql_update(Transaction).where(Transaction.category_id == category_id).values(category_id=None)
    )
    await db.delete(category)
    asyncio.create_task(emit_event(household_id, "category.updated"))
