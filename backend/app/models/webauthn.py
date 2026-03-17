from __future__ import annotations

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, LargeBinary, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class WebAuthnCredential(Base):
    """Stored passkey credential for a user (one user can have multiple passkeys)."""
    __tablename__ = "webauthn_credentials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True, index=True)  # raw credential id
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship(back_populates="webauthn_credentials")
