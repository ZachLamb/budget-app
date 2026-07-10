# Categories page overhaul — design

**Date:** 2026-07-10
**Branch:** `feat/categories-page-improvements`
**Status:** Approved (bugs + feature parity + reorder + usage counts; smart delete; @dnd-kit approved)

## Problem

The categories page (`frontend/src/app/(app)/categories/page.tsx`) is a single
232-line component with several confirmed bugs, no editing features beyond
create/delete, and delete operations that fail with 500s and no user feedback.
The backend routes (`backend/app/api/routes/categories.py`) have no tests, no
input validation, and no handling of foreign-key references on delete.

### Confirmed bugs

1. **Deletes 500 on referenced rows.** `Category.group_id` and the FKs from
   `transactions`, `budget_entries`, `rules`, `payees.default_category_id`, and
   `recurring` have no cascade/ondelete rules, and the delete routes do not
   handle references. Deleting a group that contains categories, or a category
   referenced elsewhere, raises IntegrityError → 500.
2. **Delete failures are silent.** `deleteGroupMutation` and `deleteCatMutation`
   have no `onError` handler (unlike payees/accounts pages, which use
   `toastApiError`). Combined with (1): the dialog closes, nothing happens, no
   feedback.
3. **Expand/collapse state resets on every mutation.** The initializing effect
   depends on `groups` (new array reference after each invalidation). With ≤5
   groups every mutation force-expands all groups; behavior flips at the 5→6
   boundary; persistence is sessionStorage-only above 5 groups.
4. **Double-submit.** Neither Enter nor the + button is guarded by `isPending`;
   pressing Enter twice creates duplicates.
5. **Lost input on failure.** The new-category input clears before the request
   resolves; the new-group input (inconsistently) clears only on success.
6. **Accessibility.** Group headers are clickable `div`s with no keyboard
   access, `role`, or `aria-expanded`; delete buttons are icon-only with no
   `aria-label`.
7. **No input validation.** Backend accepts empty names; names >255 chars blow
   past the DB column → 500. No length caps at the boundary.
8. **Unstable ordering.** Every group/category is created with `sort_order=0`,
   so display order among ties is undefined.

### Missing features (API exists, UI doesn't)

Rename group/category, move category between groups, mark group as income.
`sort_order` columns exist but there is no reorder UI or endpoint.

## Design

### Backend

**Validation** (`backend/app/schemas/category.py`): `name` fields get
`min_length=1, max_length=255` and whitespace stripping on create and update
schemas. Invalid names → 422.

**Smart delete** (`backend/app/api/routes/categories.py`):

- `DELETE /categories/{id}`: if referenced by budget entries, rules, payee
  defaults, or recurring items → **409** with a human-readable detail listing
  the blockers. Otherwise set `transactions.category_id = NULL` for its
  transactions, then delete. 204.
- `DELETE /categories/groups/{id}`: same check across all child categories,
  all-or-nothing (any blocked category → 409 naming it). If clear: null the
  transactions, delete categories, delete group. 204.

**Usage endpoint**: `GET /categories/usage` →
`{ [category_id]: { transactions, budget_entries, rules, payees, recurring } }`
for the caller's household. Grouped-count queries, merged in Python. Kept
separate from `GET /categories/groups` so the existing response shape (consumed
elsewhere) doesn't change.

**Reorder endpoints** (declared before the dynamic `/{category_id}` route):

- `PUT /categories/groups/order` body `{ ordered_ids: string[] }`
- `PUT /categories/order` body `{ group_id: string, ordered_ids: string[] }`

Both validate that every id belongs to the caller's household (404/400 if not)
and set `sort_order` from array index. Creates also change: new groups and
categories get `max(sort_order) + 1` within their scope so creation order is
stable. List queries get a `created_at` tie-break.

**Tests**: new `backend/tests/test_categories_routes.py` — validation errors,
smart-delete blocked and allowed paths, transaction nulling, group cascade
delete, reorder happy path + ownership rejection, usage counts, and
cross-household isolation on every route.

**Out of scope**: DB-level `ON DELETE` rules (Alembic migration touching FKs).
App layer handles references; DB-level enforcement is a noted follow-up.

### Frontend

The page splits into colocated files (pattern: budget page):
`page.tsx` (data + layout), `group-item.tsx`, `category-item.tsx`.

**Bug fixes**: `onError` toasts on all mutations; `isPending` guards on
Enter/click; inputs keep text on failure, clear on success; expand state
initialized once and persisted to localStorage regardless of group count (the
5-group threshold and sessionStorage logic are removed); real buttons with
`aria-expanded`/`aria-label`s and keyboard toggling.

**Group row**: chevron + name + income badge + category count + drag handle +
`⋯` menu (Rename inline with Enter/Esc, Mark as income/spending toggle,
Delete).

**Category row**: name + muted usage hint ("14 txns") + drag handle + `⋯` menu
(Rename inline, Move to ▸ submenu of other groups, Delete).

**Drag-to-reorder** via `@dnd-kit/core` + `@dnd-kit/sortable` (new dependency,
approved): groups sortable; categories sortable within a group. Optimistic
update with rollback + toast on error. Keyboard sorting comes with dnd-kit.

**Delete dialogs** state consequences from usage data: "12 transactions will
become uncategorized" / "Can't delete — used by 2 rules and 1 payee default"
(confirm disabled when blocked). Backend 409 remains as defense in depth.

**Header area**: expand/collapse-all toggle; quick-add group input stays at the
top, gains an "income group" checkbox.

**Frontend tests** (Vitest): reorder utility, expand-state persistence
behavior, rename/delete flows on the row components.

## Error handling

- All mutations surface failures via `toastApiError` (server `detail` messages
  flow through the existing axios interceptor formatting).
- 409 delete blockers render the server's human-readable detail.
- Optimistic reorder rolls back cached query data on error.

## Verification

`./scripts/ci-local.sh` from repo root (backend pytest + frontend lint, Vitest,
fallow, build), plus a manual dev-server walkthrough of: create/rename/move/
delete flows, income toggle, reorder persistence across reload, delete-blocked
messaging, and keyboard-only operation.
