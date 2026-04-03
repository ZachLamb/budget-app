from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


CommitmentKind = Literal["cap", "cancel", "save", "custom"]
CommitmentStatus = Literal["active", "done", "dismissed"]


class CycleCommitmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    kind: CommitmentKind = "custom"
    payload: Optional[dict[str, Any]] = None


class CycleCommitmentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    status: Optional[CommitmentStatus] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        if self.title is None and self.status is None:
            raise ValueError("Provide title and/or status")
        return self


class CycleCommitmentResponse(BaseModel):
    id: str
    household_id: str
    cycle_start_date: date
    cycle_end_date: date
    title: str
    kind: str
    payload: Optional[dict[str, Any]] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
