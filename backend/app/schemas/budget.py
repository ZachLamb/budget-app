from pydantic import BaseModel
from decimal import Decimal


class BudgetAssignmentUpsert(BaseModel):
    category_id: str
    month: str  # YYYY-MM
    assigned_amount: Decimal


class BudgetAssignmentResponse(BaseModel):
    id: str
    household_id: str
    category_id: str
    month: str
    assigned_amount: Decimal

    model_config = {"from_attributes": True}


class CategoryBudgetRow(BaseModel):
    category_id: str
    category_name: str
    group_id: str
    assigned: Decimal
    activity: Decimal
    available: Decimal
    carryover: Decimal


class GroupBudgetRow(BaseModel):
    group_id: str
    group_name: str
    sort_order: int
    is_income: bool
    assigned: Decimal
    activity: Decimal
    available: Decimal
    carryover: Decimal
    categories: list[CategoryBudgetRow]


class BudgetMonthResponse(BaseModel):
    month: str
    total_income: Decimal
    total_assigned: Decimal
    total_activity: Decimal
    total_available: Decimal
    # Envelope rollover (docs/superpowers/specs/2026-07-02-budget-rollover-design.md):
    # `available` is cumulative (carryover + assigned + activity).
    ready_to_assign: Decimal
    total_carryover_in: Decimal
    overspend_deducted: Decimal
    groups: list[GroupBudgetRow]
