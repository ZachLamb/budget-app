from __future__ import annotations

import re
from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


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
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class PasskeyRegisterOptionsRequest(BaseModel):
    email: str
    name: str
    household_name: str = "My Household"


class PasskeyAuthenticateOptionsRequest(BaseModel):
    email: Optional[str] = None  # optional; if omitted, discoverable (resident) key is used


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
