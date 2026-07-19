from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class RuleCreate(BaseModel):
    match_field: str  # payee, amount, notes
    match_type: str  # contains, exact, regex
    match_value: str
    category_id: str
    priority: int = 0
    source: str = "manual"


class RuleUpdate(BaseModel):
    match_field: Optional[str] = None
    match_type: Optional[str] = None
    match_value: Optional[str] = None
    category_id: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


class RuleResponse(BaseModel):
    id: str
    household_id: str
    priority: int
    match_field: str
    match_type: str
    match_value: str
    category_id: str
    source: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RuleSuggestionResponse(BaseModel):
    """A rule the user could create, derived from consistent categorization history."""

    match_field: str
    match_type: str
    match_value: str
    category_id: str
    category_name: str
    support: int  # txns already filed under this category for the payee
    total: int  # total categorized txns for the payee
    dominance: float  # support / total, in [0, 1]
