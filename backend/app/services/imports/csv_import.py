from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from dataclasses import dataclass
from typing import Optional


@dataclass
class ParsedTransaction:
    date: date
    payee_name: str
    amount: Decimal
    memo: Optional[str] = None


@dataclass
class CSVParseResult:
    transactions: list[ParsedTransaction]
    errors: list[str]
    detected_format: str


def _parse_date(value: str) -> Optional[date]:
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%m-%d-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(value: str) -> Optional[Decimal]:
    cleaned = value.strip().replace("$", "").replace(",", "")
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def detect_csv_format(headers: list[str]) -> str:
    headers_lower = [h.lower().strip() for h in headers]

    if "transaction date" in headers_lower and "post date" in headers_lower:
        return "chase"
    if "date" in headers_lower and "reference" in headers_lower and "amount" in headers_lower:
        return "amex"
    return "generic"


def parse_chase_csv(reader: csv.DictReader) -> CSVParseResult:
    transactions = []
    errors = []
    for i, row in enumerate(reader):
        txn_date = _parse_date(row.get("Transaction Date", row.get("Posting Date", "")))
        if not txn_date:
            errors.append(f"Row {i+1}: invalid date")
            continue
        amount = _parse_amount(row.get("Amount", ""))
        if amount is None:
            errors.append(f"Row {i+1}: invalid amount")
            continue
        transactions.append(ParsedTransaction(
            date=txn_date,
            payee_name=row.get("Description", "").strip(),
            amount=amount,
            memo=row.get("Memo", row.get("Category", None)),
        ))
    return CSVParseResult(transactions=transactions, errors=errors, detected_format="chase")


def parse_amex_csv(reader: csv.DictReader) -> CSVParseResult:
    transactions = []
    errors = []
    for i, row in enumerate(reader):
        txn_date = _parse_date(row.get("Date", ""))
        if not txn_date:
            errors.append(f"Row {i+1}: invalid date")
            continue
        amount = _parse_amount(row.get("Amount", ""))
        if amount is None:
            errors.append(f"Row {i+1}: invalid amount")
            continue
        # Amex shows charges as positive, reverse to negative (outflow)
        amount = -amount
        transactions.append(ParsedTransaction(
            date=txn_date,
            payee_name=row.get("Description", "").strip(),
            amount=amount,
            memo=row.get("Extended Details", None),
        ))
    return CSVParseResult(transactions=transactions, errors=errors, detected_format="amex")


def parse_generic_csv(reader: csv.DictReader) -> CSVParseResult:
    transactions = []
    errors = []
    headers_lower = {h.lower().strip(): h for h in (reader.fieldnames or [])}

    date_col = None
    for candidate in ["date", "transaction date", "posting date", "trans date"]:
        if candidate in headers_lower:
            date_col = headers_lower[candidate]
            break

    amount_col = None
    for candidate in ["amount", "transaction amount", "debit"]:
        if candidate in headers_lower:
            amount_col = headers_lower[candidate]
            break

    payee_col = None
    for candidate in ["description", "payee", "merchant", "name", "memo"]:
        if candidate in headers_lower:
            payee_col = headers_lower[candidate]
            break

    if not date_col or not amount_col:
        return CSVParseResult(transactions=[], errors=["Could not detect date and amount columns"], detected_format="generic")

    for i, row in enumerate(reader):
        txn_date = _parse_date(row.get(date_col, ""))
        if not txn_date:
            errors.append(f"Row {i+1}: invalid date")
            continue
        amount = _parse_amount(row.get(amount_col, ""))
        if amount is None:
            errors.append(f"Row {i+1}: invalid amount")
            continue
        transactions.append(ParsedTransaction(
            date=txn_date,
            payee_name=row.get(payee_col, "Unknown").strip() if payee_col else "Unknown",
            amount=amount,
        ))
    return CSVParseResult(transactions=transactions, errors=errors, detected_format="generic")


def parse_csv(content: str) -> CSVParseResult:
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        return CSVParseResult(transactions=[], errors=["Empty CSV or no headers"], detected_format="unknown")

    fmt = detect_csv_format(reader.fieldnames)
    if fmt == "chase":
        return parse_chase_csv(reader)
    elif fmt == "amex":
        return parse_amex_csv(reader)
    else:
        return parse_generic_csv(reader)
