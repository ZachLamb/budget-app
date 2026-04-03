from typing import Literal, Optional

from pydantic import BaseModel, Field


class CancelGuideResponse(BaseModel):
    """Always HTTP 200: matched=false uses generic_steps only."""

    matched: bool
    merchant_key: Optional[str] = None
    display_name: Optional[str] = None
    verified_cancel_url: Optional[str] = None
    steps: list[str] = Field(default_factory=list)
    verification: Optional[Literal["official_docs", "maintainer_curated", "community"]] = None
    link_is_verified: bool = False
    generic_steps: list[str] = Field(default_factory=list)
    disclaimer: Optional[str] = None
