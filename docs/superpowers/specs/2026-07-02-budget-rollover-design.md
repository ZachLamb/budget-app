# Budget rollover (envelope carryover) — design

**Date:** 2026-07-02
**Status:** approved
**Origin:** team review found that budget "available" resets every calendar month
(`backend/app/api/routes/budget.py:87` computes `available = assigned + activity`
for the viewed month only). Owner confirmed this is not intended: unspent and
overspent balances must carry month-to-month and be surfaced in the UI.

## Requirements (decided with owner)

1. **Overspend semantics: YNAB-style reset.** An envelope overspent at month
   close resets to $0; the shortfall is deducted from the *next* month's Ready
   to Assign. Within the month it happens, the category shows its true negative.
2. **Backfill: full history.** Carryover is recomputed from the earliest data
   forward, as if rollover had always existed. No anchor month, no stored state.
   Current numbers will shift once when this ships; owner accepts one
   re-balancing session.
3. **UI: subtext + summary.** No new table column. Categories with nonzero
   carry-in or a current-month overspend get one line of subtext; the Ready to
   Assign card notes prior-month overspend deductions.
4. **Approach: compute on read.** No schema change, no migration, no
   materialized state. Backdated edits are automatically correct.

## Core math

New module `backend/app/services/budget_math.py` — a pure fold, no I/O, no ORM.

Inputs:
- `assigned: dict[(category_id, month), Decimal]` — all assignment rows ≤ viewed month
- `activity: dict[(category_id, month), Decimal]` — budget-account, categorized,
  non-split-child transaction sums ≤ viewed month (spending is negative)
- `income_category_ids: set[str]` — categories in `is_income` groups
- `viewed_month: str` (`YYYY-MM`)

Fold, oldest month → viewed month, per non-income category:

```
raw(m)        = carry_in(m) + assigned(m) + activity(m)
carry_in(m+1) = max(0, raw(m))
overspend(m) += max(0, -raw(m))          # clipped at the m → m+1 boundary
```

Outputs for the viewed month M:
- per category: `carryover = carry_in(M)`, `available = carryover + assigned(M) + activity(M)`
  (may be negative during M — the clamp applies only when M rolls into M+1)
- `ready_to_assign(M) = cum_income(≤M) − cum_assigned(≤M) − Σ_{m<M} overspend(m)`
- totals: `total_carryover_in` (sum of positive carry-ins), `overspend_deducted`
  (Σ overspend for months < M)

Month keys are the union of months appearing in either input map; gap months
pass carry through unchanged. Income categories are excluded from envelope
carry; their activity feeds `total_income` as today.

`cum_assigned` sums **all** assignment rows (even for categories no longer in
the group tree) so Ready to Assign stays honest after a category deletion. A
deleted category's envelope history disappears from carryover — same
visibility as today; accepted.

## API changes

`GET /api/budget/month/{month}` (`backend/app/api/routes/budget.py`):
- Fetch scope widens from "= month" to "≤ month" for assignments and activity
  (two GROUP BY category+month queries; a few hundred rows at this scale).
- Route delegates to `budget_math`; keeps only I/O and response shaping.

Schema (`backend/app/schemas/budget.py`):
- `CategoryBudgetRow` + `carryover: Decimal`
- `GroupBudgetRow` + `carryover: Decimal` (sum of member categories)
- `BudgetMonthResponse` + `ready_to_assign: Decimal`,
  `total_carryover_in: Decimal`, `overspend_deducted: Decimal`
- `available` semantics change to cumulative (documented in the schema docstring).

Ready to Assign moves server-side. The frontend currently derives it as
`total_income − total_assigned` (`frontend/src/app/(app)/budget/page.tsx:631`);
that derivation cannot see history and is removed.

Other consumers of budget "available" (AI facts endpoints, plan/next-best-action
facts) must route through `budget_math` — to be verified and unified during
implementation. `POST /copy-month` and `PUT /assign` are unchanged.

## Frontend changes

`frontend/src/lib/api/budget.ts`: add the new response fields.

`frontend/src/app/(app)/budget/page.tsx`:
- Ready to Assign card reads `ready_to_assign`; when `overspend_deducted > 0`,
  subtext: "includes −$X prior overspend".
- Category rows: when `carryover ≠ 0`, subtext "includes +$X carried from
  <prev month>" (or −… only via the negative-available case below — carry-in is
  never negative under the clamp rule). When `available < 0`, subtext
  "overspent — will reduce next month's Ready to Assign".
- `AssignedCell` optimistic update becomes
  `available = newAssigned + activity + carryover`; `ready_to_assign` adjusts by
  the assignment delta. `onSettled` invalidation still refetches truth.
- Subtext strings built by a small pure helper (e.g.
  `frontend/src/lib/budget-rollover-copy.ts`) so copy is unit-testable.

## Demo seed

`backend/app/demo_seed.py` gains one prior-month underspent category so demo
mode visibly shows a carry-in note. (Demo polish is medium priority per owner;
this one example rides along because it doubles as living documentation.)

## Edge cases

- **Gap months** (no assignments, no activity): carry passes through.
- **Earliest month**: first month with any assignment or budget-account
  transaction for the household.
- **Future months**: fold extends naturally; the current partial month carries
  as-is (matches YNAB).
- **Uncategorized transactions** (`category_id IS NULL`): touch no envelope —
  unchanged from today.
- **Split parents** (`parent_transaction_id` filter): unchanged from today.

## Testing

- **New `backend/tests/test_budget_math.py`** (pure function): single month ≡
  today's behavior; carry accumulates across months; overspend clamps at the
  boundary and deducts from the following month's RTA — not the month it
  happened; viewed-month overspend shows negative available; income categories
  excluded; gap months pass carry; adjusted-invariant case (RTA + Σ available
  reconciles with cumulative income, spending, and forgiven overspend).
- **New `backend/tests/test_budget_routes.py`** (HTTP, SQLite fixture pattern
  from `test_facts_endpoints.py`): multi-month seeded data through
  `GET /month/{month}`; `PUT /assign` upsert; cross-household isolation. This
  also closes the team review's "budget routes untested" High finding.
- **Frontend**: unit tests for the subtext helper; render test asserting
  summary/row notes appear only when nonzero.

## Out of scope (YAGNI)

Per-category rollover toggles; configurable anchor month; credit-vs-cash
overspend distinction; pay-cycle-based budget months; materialized snapshots;
reports-page changes.
