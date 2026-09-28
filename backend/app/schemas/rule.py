from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import date, datetime
from typing import Literal, Optional

from app.services.categorization.pattern_guard import (
    MAX_MATCH_VALUE,
    BadPattern,
    check_match_value,
)

#: Spelled out rather than left as `str`. A rule whose field or type is
#: not one of these matches nothing and reports no error -- it just sits
#: there switched on, quietly doing nothing.
MatchField = Literal["payee", "notes", "amount"]
MatchType = Literal["contains", "exact", "regex"]


def _validated(match_type: str, match_value: str) -> None:
    """Re-raise a pattern complaint as something Pydantic will report."""
    try:
        check_match_value(match_type, match_value)
    except BadPattern as exc:
        raise ValueError(str(exc)) from exc


class RuleCreate(BaseModel):
    match_field: MatchField
    match_type: MatchType
    match_value: str = Field(..., min_length=1, max_length=MAX_MATCH_VALUE)
    category_id: str
    priority: int = 0
    source: str = "manual"

    @model_validator(mode="after")
    def _pattern_is_usable(self):
        _validated(self.match_type, self.match_value)
        return self


class RuleUpdate(BaseModel):
    match_field: Optional[MatchField] = None
    match_type: Optional[MatchType] = None
    match_value: Optional[str] = Field(None, min_length=1, max_length=MAX_MATCH_VALUE)
    category_id: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None

    @model_validator(mode="after")
    def _pattern_is_usable(self):
        # A partial update can change the value, the type, or both. Only
        # the value arriving is enough to need checking -- but the type it
        # will be checked against lives on the stored row, so the route
        # revalidates against the merged result. Here we can only catch
        # what is self-contained.
        if self.match_value is not None and self.match_type is not None:
            _validated(self.match_type, self.match_value)
        return self


class RulePreviewRequest(BaseModel):
    """A rule that may not exist yet, to be matched but not saved."""

    match_field: MatchField
    match_type: MatchType
    match_value: str = Field(..., min_length=1, max_length=MAX_MATCH_VALUE)

    @model_validator(mode="after")
    def _pattern_is_usable(self):
        _validated(self.match_type, self.match_value)
        return self


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


class RuleMatchResponse(BaseModel):
    """One transaction a rule would claim."""

    transaction_id: str
    date: date
    payee_name: Optional[str] = None
    amount: Decimal
    #: The text the rule actually matched against, so a surprising match
    #: can be understood without opening the transaction.
    matched_on: str
    rule_id: str
    category_id: str


class RulePreviewResponse(BaseModel):
    """What running the rules would do, before doing it."""

    total: int
    #: A sample, not the lot. The count is the number that matters, and
    #: sending thousands of rows to render ten of them helps nobody.
    sample: list[RuleMatchResponse] = []
