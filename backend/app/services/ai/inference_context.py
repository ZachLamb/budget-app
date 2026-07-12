from __future__ import annotations

"""Build prompt contexts for client-side local LLM inference.

These functions return {system, prompt, response_schema, feature_id} — the
client sends this to its local LLM (Ollama, CoreML, Gemini Nano, WebLLM) and
posts the structured result to /api/ai/execute-action.

Security: no user content is inferred server-side here. We only build and
return the prompt string. The client owns inference.
"""

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, CategoryGroup
from app.services.ai.context import build_financial_context


CATEGORIZE_SYSTEM = (
    "You are a financial categorization assistant. "
    "Assign each transaction to one of the provided categories. "
    "Respond with valid JSON only — no prose, no markdown fences."
)

CATEGORIZE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "category_name": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["id", "category_name", "confidence"],
    },
}

CHAT_SYSTEM = (
    "You are a helpful personal finance assistant. "
    "Answer questions about the user's budget concisely and accurately. "
    "Use only the financial context provided — do not fabricate data. "
    "Respond in plain text."
)

PARSE_DOCUMENT_SYSTEM = (
    "You are a bank statement parser. "
    "Extract individual transactions from the provided text. "
    "Respond with valid JSON only — no prose, no markdown fences."
)

PARSE_DOCUMENT_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "date": {"type": "string", "description": "ISO 8601 date (YYYY-MM-DD)"},
            "payee": {"type": "string"},
            "amount": {
                "type": "number",
                "description": "Negative for expenses, positive for income",
            },
        },
        "required": ["date", "payee", "amount"],
    },
}


async def build_categorize_context(
    db: AsyncSession,
    household_id: str,
    transactions: list[dict],
) -> dict:
    """Return prompt context for transaction categorization."""
    result = await db.execute(
        select(Category.name, CategoryGroup.name.label("group_name"))
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
        .order_by(CategoryGroup.name, Category.name)
    )
    cats = [{"category": r.name, "group": r.group_name} for r in result.all()]
    cats_json = json.dumps(cats, indent=2)

    txn_lines = "\n".join(
        f"- id={t['id']} payee={t['payee']} amount={t['amount']} date={t['date']}"
        for t in transactions
    )

    prompt = (
        f"Available categories:\n{cats_json}\n\n"
        f"Transactions to categorize:\n{txn_lines}\n\n"
        f"Return a JSON array matching the response_schema. "
        f"Use the exact category_name from the list above."
    )

    return {
        "system": CATEGORIZE_SYSTEM,
        "prompt": prompt,
        "response_schema": CATEGORIZE_SCHEMA,
        "feature_id": "categorize",
    }


async def build_chat_context(
    db: AsyncSession,
    household_id: str,
    query: str,
) -> dict:
    """Return prompt context for conversational budget Q&A."""
    financial_ctx = await build_financial_context(db, household_id)
    prompt = f"Financial context:\n{financial_ctx}\n\nUser question: {query}"
    return {
        "system": CHAT_SYSTEM,
        "prompt": prompt,
        "response_schema": {"type": "string"},
        "feature_id": "chat",
    }


def build_parse_document_context(text: str) -> dict:
    """Return prompt context for parsing a raw document text."""
    prompt = (
        f"Parse all transactions from the following bank statement text. "
        f"Return a JSON array matching the response_schema.\n\n"
        f"Document text:\n{text}"
    )
    return {
        "system": PARSE_DOCUMENT_SYSTEM,
        "prompt": prompt,
        "response_schema": PARSE_DOCUMENT_SCHEMA,
        "feature_id": "parse_document",
    }
