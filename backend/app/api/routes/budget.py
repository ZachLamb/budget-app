from datetime import date as date_cls
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, extract
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.api.deps import get_household_id
from app.models import BudgetAssignment, CategoryGroup, Category, Transaction, Account
from app.utils import parse_month
from app.services.budget_math import CategoryMonthResult, compute_rollover
from app.schemas.budget import (
    BudgetAssignmentUpsert,
    BudgetAssignmentResponse,
    BudgetMonthResponse,
    GroupBudgetRow,
    CategoryBudgetRow,
)

router = APIRouter()


@router.get("/month/{month}", response_model=BudgetMonthResponse)
async def get_budget_month(
    month: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    year, month_num = parse_month(month)
    first_of_next = (
        date_cls(year + 1, 1, 1) if month_num == 12 else date_cls(year, month_num + 1, 1)
    )

    groups_result = await db.execute(
        select(CategoryGroup)
        .where(CategoryGroup.household_id == household_id)
        .options(selectinload(CategoryGroup.categories))
        .order_by(CategoryGroup.sort_order)
    )
    groups = groups_result.scalars().all()

    assignments_result = await db.execute(
        select(BudgetAssignment).where(
            BudgetAssignment.household_id == household_id,
            BudgetAssignment.month <= month,
        )
    )
    assigned_by_cat_month: dict[tuple[str, str], Decimal] = {
        (a.category_id, a.month): a.assigned_amount
        for a in assignments_result.scalars().all()
    }

    budget_account_ids = (
        select(Account.id).where(
            Account.household_id == household_id,
            Account.is_budget_account.is_(True),
            Account.closed_at.is_(None),
        )
    )

    activity_result = await db.execute(
        select(
            Transaction.category_id,
            extract("year", Transaction.date).label("y"),
            extract("month", Transaction.date).label("m"),
            func.sum(Transaction.amount),
        )
        .where(
            Transaction.account_id.in_(budget_account_ids),
            Transaction.date < first_of_next,
            Transaction.category_id.isnot(None),
            Transaction.parent_transaction_id.is_(None),
        )
        .group_by(
            Transaction.category_id,
            extract("year", Transaction.date),
            extract("month", Transaction.date),
        )
    )
    activity_by_cat_month: dict[tuple[str, str], Decimal] = {
        (row[0], f"{int(row[1]):04d}-{int(row[2]):02d}"): row[3] or Decimal(0)
        for row in activity_result.all()
    }

    income_category_ids = {
        cat.id for g in groups if g.is_income for cat in g.categories
    }
    roll = compute_rollover(
        assigned_by_cat_month, activity_by_cat_month, income_category_ids, month
    )
    zero_row = CategoryMonthResult(Decimal(0), Decimal(0), Decimal(0), Decimal(0))

    total_income = Decimal(0)
    total_assigned = Decimal(0)
    total_activity = Decimal(0)
    total_available = Decimal(0)

    group_rows: list[GroupBudgetRow] = []
    for group in groups:
        g_assigned = Decimal(0)
        g_activity = Decimal(0)
        g_available = Decimal(0)
        g_carryover = Decimal(0)
        cat_rows: list[CategoryBudgetRow] = []

        for cat in sorted(group.categories, key=lambda c: c.sort_order):
            if group.is_income:
                assigned = assigned_by_cat_month.get((cat.id, month), Decimal(0))
                activity = activity_by_cat_month.get((cat.id, month), Decimal(0))
                row = CategoryMonthResult(Decimal(0), assigned, activity, assigned + activity)
            else:
                row = roll.categories.get(cat.id, zero_row)
            cat_rows.append(CategoryBudgetRow(
                category_id=cat.id,
                category_name=cat.name,
                group_id=group.id,
                assigned=row.assigned,
                activity=row.activity,
                available=row.available,
                carryover=row.carryover,
            ))
            g_assigned += row.assigned
            g_activity += row.activity
            g_available += row.available
            g_carryover += row.carryover

        if group.is_income:
            total_income += g_activity
        else:
            total_assigned += g_assigned
            total_activity += g_activity
            total_available += g_available

        group_rows.append(GroupBudgetRow(
            group_id=group.id,
            group_name=group.name,
            sort_order=group.sort_order,
            is_income=group.is_income,
            assigned=g_assigned,
            activity=g_activity,
            available=g_available,
            carryover=g_carryover,
            categories=cat_rows,
        ))

    return BudgetMonthResponse(
        month=month,
        total_income=total_income,
        total_assigned=total_assigned,
        total_activity=total_activity,
        total_available=total_available,
        ready_to_assign=roll.ready_to_assign,
        total_carryover_in=roll.total_carryover_in,
        overspend_deducted=roll.overspend_deducted,
        groups=group_rows,
    )


@router.put("/assign", response_model=BudgetAssignmentResponse)
async def upsert_budget_assignment(
    data: BudgetAssignmentUpsert,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    parse_month(data.month)

    cat_result = await db.execute(
        select(Category)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(Category.id == data.category_id, CategoryGroup.household_id == household_id)
    )
    if not cat_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Category not found")

    result = await db.execute(
        select(BudgetAssignment).where(
            BudgetAssignment.household_id == household_id,
            BudgetAssignment.category_id == data.category_id,
            BudgetAssignment.month == data.month,
        )
    )
    assignment = result.scalar_one_or_none()

    if assignment:
        assignment.assigned_amount = data.assigned_amount
    else:
        assignment = BudgetAssignment(
            household_id=household_id,
            category_id=data.category_id,
            month=data.month,
            assigned_amount=data.assigned_amount,
        )
        db.add(assignment)

    await db.flush()
    await db.refresh(assignment)
    return BudgetAssignmentResponse.model_validate(assignment)


class CopyMonthRequest(BaseModel):
    source_month: str
    target_month: str


@router.post("/copy-month")
async def copy_budget_month(
    data: CopyMonthRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    parse_month(data.source_month)
    parse_month(data.target_month)

    source_result = await db.execute(
        select(BudgetAssignment).where(
            BudgetAssignment.household_id == household_id,
            BudgetAssignment.month == data.source_month,
        )
    )
    source_assignments = source_result.scalars().all()
    if not source_assignments:
        raise HTTPException(status_code=404, detail="No budget assignments found for source month")

    copied = 0
    for src in source_assignments:
        existing = await db.execute(
            select(BudgetAssignment).where(
                BudgetAssignment.household_id == household_id,
                BudgetAssignment.category_id == src.category_id,
                BudgetAssignment.month == data.target_month,
            )
        )
        if existing.scalar_one_or_none():
            continue
        assignment = BudgetAssignment(
            household_id=household_id,
            category_id=src.category_id,
            month=data.target_month,
            assigned_amount=src.assigned_amount,
        )
        db.add(assignment)
        copied += 1

    await db.flush()
    return {"copied": copied}
