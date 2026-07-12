from __future__ import annotations

"""Inference-context endpoints — return prompt templates for client-side LLM inference.

Clients (macOS app, web browser) call these to get a {system, prompt, response_schema,
feature_id} payload, run inference locally, then POST the structured result to
/api/ai/execute-action. This keeps all inference on-device regardless of platform.
"""

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.routes.ai import _require_ai_enabled
from app.models.user import User
from app.services.ai.inference_context import (
    build_categorize_context,
    build_chat_context,
    build_parse_document_context,
)

router = APIRouter()


class InferenceContextResponse(BaseModel):
    system: str
    prompt: str
    response_schema: dict[str, Any]
    feature_id: str


class TransactionInput(BaseModel):
    id: str
    payee: str
    amount: float
    date: str


class CategorizeRequest(BaseModel):
    transactions: list[TransactionInput] = Field(..., min_length=1, max_length=100)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)


class ParseDocumentRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50_000)


@router.post("/categorize", response_model=InferenceContextResponse)
async def inference_context_categorize(
    body: CategorizeRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return prompt context for categorizing the given transactions."""
    txns = [t.model_dump() for t in body.transactions]
    return await build_categorize_context(db, household_id, txns)


@router.post("/chat", response_model=InferenceContextResponse)
async def inference_context_chat(
    body: ChatRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return prompt context for answering a budget question."""
    return await build_chat_context(db, household_id, body.query)


@router.post("/parse-document", response_model=InferenceContextResponse)
async def inference_context_parse_document(
    body: ParseDocumentRequest,
    _household_id: str = Depends(_require_ai_enabled),
    _user: User = Depends(get_current_user),
):
    """Return prompt context for parsing a raw bank statement or CSV text."""
    return build_parse_document_context(body.text)
