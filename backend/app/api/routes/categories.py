from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.api.deps import get_household_id
from app.models import CategoryGroup, Category
from app.schemas.category import (
    CategoryGroupCreate, CategoryGroupUpdate, CategoryGroupResponse,
    CategoryCreate, CategoryUpdate, CategoryResponse,
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
        .order_by(CategoryGroup.sort_order)
    )
    return [CategoryGroupResponse.model_validate(g) for g in result.scalars().all()]


@router.post("/groups", response_model=CategoryGroupResponse, status_code=201)
async def create_category_group(
    data: CategoryGroupCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    group = CategoryGroup(household_id=household_id, **data.model_dump())
    db.add(group)
    await db.flush()
    # Fresh object post-flush: async lazy-load of .categories would raise MissingGreenlet during serialization; refresh loads the (empty) collection.
    await db.refresh(group, ["categories"])
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
    await db.delete(group)


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

    category = Category(**data.model_dump())
    db.add(category)
    await db.flush()
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
    await db.delete(category)
