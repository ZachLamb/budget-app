from __future__ import annotations

import re
from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator

DEMO_EMAIL = "demo@snacksbudget.app"


class UserCreate(BaseModel):
    email: str = Field(..., max_length=254)
    name: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=8, max_length=128)
    household_name: str = Field(default="My Household", max_length=200)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v


class UserLogin(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=128)


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    household_id: str
    role: str
    # "pending" | "approved" | "rejected" — surfaced so the frontend can
    # render role-aware UI (e.g. show the admin panel only when role=admin).
    # The auth gate is enforced server-side in services.auth.admin_gate; the
    # frontend just uses this for display.
    status: str
    created_at: datetime
    # True only for the shared demo account. Frontend uses this (not the
    # server-wide demo_mode flag) to gate read-only UI so that admin users
    # on a demo-enabled backend still get full write access.
    is_demo_user: bool = False

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _set_demo_flag(self) -> "UserResponse":
        self.is_demo_user = self.email.lower() == DEMO_EMAIL
        return self


class TokenResponse(BaseModel):
    """Login response. Session is established via httpOnly cookie; access_token is omitted for browsers."""
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user: UserResponse


class PasskeyRegisterOptionsRequest(BaseModel):
    email: str = Field(..., max_length=254)
    name: str = Field(..., min_length=1, max_length=200)
    household_name: str = "My Household"

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v


class PasskeyAuthenticateOptionsRequest(BaseModel):
    email: Optional[str] = None  # optional; if omitted, discoverable (resident) key is used

    @field_validator("email")
    @classmethod
    def normalize_optional_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        v = str(v).strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v


class PasskeyRegisterVerifyRequest(BaseModel):
    """Body for POST /auth/passkey/register/verify. credential = JSON from navigator.credentials.create()."""
    credential: dict[str, Any]


class PasskeyAuthenticateVerifyRequest(BaseModel):
    """Body for POST /auth/passkey/authenticate/verify. credential = JSON from navigator.credentials.get()."""
    credential: dict[str, Any]


class PasskeyCredentialListItem(BaseModel):
    """One passkey credential for list response (id and created_at only; no credential_id or public_key)."""
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}
