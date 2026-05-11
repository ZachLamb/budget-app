from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # None for Google-only users
    google_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True, nullable=True)
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("households.id"))
    role: Mapped[str] = mapped_column(String(20), default="owner")
    # Approval gate: "pending" | "approved" | "rejected". New users default
    # to pending and are blocked from login until an admin approves them.
    # Existing rows (pre-migration) backfilled to "approved" so we don't
    # lock anyone out retroactively. The User matching settings.admin_email
    # is auto-promoted to "approved" on next login (see services.auth.admin_gate).
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    household: Mapped["Household"] = relationship(back_populates="users")
    webauthn_credentials: Mapped[list["WebAuthnCredential"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
