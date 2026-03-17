# Goals Tab (Financial Plan) — Review, Edge Cases, and Improvements

## Overview

Review of the **Goals** tab on the Financial Plan page ([frontend/src/app/plan/page.tsx](frontend/src/app/plan/page.tsx)), including bugs, edge cases, and new features such as **LLM-suggested goals**.

---

## Current Behavior Summary

- **GoalsTab**: Lists active and completed goals; create via dialog (GoalForm), edit in a second dialog, delete via ConfirmDialog.
- **GoalCard**: Shows icon, name, description, type badge, progress bar, “to go” / monthly / months remaining / target date, and Edit / Mark done / Delete.
- **GoalForm**: Name, type, linked account, target/current amount, monthly contribution, target date, description. Save disabled when `!form.name || form.target_amount <= 0`.
- **Backend** ([backend/app/api/routes/goals.py](backend/app/api/routes/goals.py)): List enriches goals with `progress_pct`, `months_remaining`, and for linked accounts overwrites `current_amount` with live balance and recomputes progress. Progress formula: `min(100, (current_amount / target_amount) * 100)`.

---

## Bugs and Edge Cases to Fix

### 1. Debt payoff progress when goal is linked to a debt account

**Issue**: For a **debt payoff** goal linked to a credit/loan account, the backend uses the account’s **live balance** (negative, e.g. -$5,000) as `current_amount`. Progress is then `(live_balance / target_amount) * 100`, which is **negative** (e.g. -100%). The frontend caps with `Math.min(100, goal.progress_pct)` so the bar can show 0% or a negative-looking value; “X to go” becomes `target - (-5000)` = wrong semantics.

**Fix (backend)**: In `list_goals`, when the linked account is a **debt account** (`account_type in ("credit", "loan")`) and the goal’s `goal_type` is `debt_payoff`, treat “current” as **amount paid so far**:  
`amount_paid = goal.target_amount + live_balance` (since `live_balance` is negative). Then:

- `resp.current_amount = max(0, amount_paid)` (or keep displaying “amount left” in UI if you prefer).
- `progress_pct = min(100, max(0, (amount_paid / goal.target_amount) * 100))`.

So progress goes from 0% (balance -5000, target 5000) to 100% (balance 0).

**Frontend**: Ensure “X to go” and progress bar make sense for debt payoff when `current_amount` is now “amount paid” (or keep showing “amount left” from backend if you add a dedicated field). No negative progress.

---

### 2. Delete confirmation dialog closes before the request completes

**Issue**: In [ConfirmDialog](frontend/src/components/confirm-dialog.tsx), the Confirm button calls `onConfirm()` and then `onOpenChange(false)`, so the dialog closes immediately. If the delete request fails, the user only sees a toast and the dialog is already gone; they might think the goal was deleted.

**Fix**: Either:

- **Option A**: Have the parent pass `loading={deleteMutation.isPending}` and **do not** close the dialog in `ConfirmDialog` on confirm; close it only in `deleteMutation.onSuccess` (e.g. `setDeleteId(null)`). So the dialog stays open with “Deleting...” until the request succeeds or the user cancels.
- **Option B**: Keep current behavior but ensure error toasts are clear (“Failed to delete goal”) so the user understands the goal still exists.

Recommendation: **Option A** for clearer UX (dialog stays open until delete succeeds or fails).

---

### 3. Goal form: negative and invalid numeric inputs

**Issue**: `parseFloat(e.target.value) || 0` turns empty or invalid input into `0`; negative input is allowed. So the user can enter a negative target or current amount. Backend may accept it and progress can be negative or nonsensical.

**Fix**:

- **Target amount**: Require `target_amount > 0` (already used to disable Save). Add validation message if user enters ≤ 0 or negative (e.g. “Target must be greater than 0”).
- **Current amount**: Clamp or validate `current_amount >= 0`. If user types negative, either clamp to 0 or show an error.
- **Monthly contribution**: Allow only `>= 0` (or show error for negative).
- Optionally trim `form.name` and show error for empty name on submit.

---

### 4. Progress bar when `progress_pct` is negative or > 100

**Issue**: Backend can return negative `progress_pct` (e.g. debt linked account before fix above) or > 100 if current > target. Frontend does `const pct = Math.min(100, goal.progress_pct)` but does not clamp the lower bound.

**Fix**: Use `const pct = Math.min(100, Math.max(0, goal.progress_pct))` in `GoalCard` so the bar never shows negative and never exceeds 100%.

---

### 5. Edit form initial state when `editGoal` has null fields

**Issue**: `GoalForm` receives `initial` with `description: editGoal.description ?? ""`, etc. If the API returns `null` for optional fields, the form already normalizes to `""` or `undefined`. No bug found, but ensure `target_date` is formatted as `YYYY-MM-DD` for `<input type="date">` (API returns ISO date string; should be fine).

**Optional**: When reopening a completed goal (“Reopen”), the backend clears `completed_at`. If the user had set `current_amount` to `target_amount`, consider whether to reset `current_amount` or leave it (current behavior: leave it; “Reopen” only toggles `is_completed`). Document or add a small “Reset progress” if desired.

---

## New Features

### 6. LLM-suggested goals

**Idea**: Add an “Suggest goals with AI” (or “Get goal ideas”) action that calls a new backend endpoint and shows suggested goals (e.g. “Pay off Visa”, “Emergency fund $10k”) that the user can accept and create.

**Backend**:

- New endpoint: `POST /api/ai/suggest-goals` (or `GET` if no body). Guard with `_require_ai_enabled` (same as other AI routes).
- Input context: Same as other AI features — household’s accounts (names, types, balances), existing goals, optionally budget/debt summary. Reuse or extend `_build_financial_context` in [backend/app/api/routes/ai.py](backend/app/api/routes/ai.py).
- Output: List of suggested goals, e.g.:
  - `name`, `goal_type`, `target_amount`, optional `account_id` (if linking to a specific debt/savings account), optional `monthly_contribution`, optional `target_date`, short `reasoning`.
- Implementation: Prompt the LLM with context and ask for 2–5 goal suggestions in a structured format (JSON). Parse and validate; return only valid items (e.g. `target_amount > 0`, `goal_type` in allowed set). If an account is suggested by name, resolve to `account_id` server-side.

**Frontend**:

- In Goals tab, add a card or button: “Suggest goals with AI” (similar to Debt tab’s “Get AI Recommendation”). On click, call the new API, show loading, then list suggestions with “Add” (creates goal and optionally links account) and “Dismiss”. Optionally “Add all” for multiple.
- Handle 403 (AI disabled) and 503 (no backend) with clear messages (reuse pattern from debt/insights).

---

### 7. Optional: Link from Debt tab to create a debt payoff goal

**Idea**: In the Debt tab, for each debt account, add a small action “Create payoff goal” that opens the Create Goal dialog with pre-filled: goal type = debt payoff, linked account = this account, target amount = current balance (or remaining balance). Reduces friction and keeps debt and goals aligned.

---

### 8. Optional: Reorder goals (sort_order)

**Backend**: Already has `sort_order` on `FinancialGoal` and `GoalUpdate`; list orders by `sort_order`. So you only need a way to change order.

**Frontend**: Allow drag-and-drop or up/down buttons to reorder active goals, then call `goalsApi.update(id, { sort_order: newIndex })` for affected goals. Lower priority; can be deferred.

---

## Implementation Order (suggested)

1. **Fix debt payoff progress** (backend: treat linked debt account balance as “amount left”; compute progress as amount paid / target). Then frontend clamp `pct` to 0–100.
2. **Fix delete dialog**: keep dialog open until delete succeeds; pass `loading` and close in `onSuccess` (and optionally adjust `ConfirmDialog` so parent controls closing).
3. **Form validation**: enforce target > 0, current >= 0, monthly >= 0; show inline errors for negative or invalid numbers.
4. **Progress bar clamp**: `Math.max(0, Math.min(100, goal.progress_pct))` in `GoalCard`.
5. **LLM goal suggestions**: backend endpoint + frontend “Suggest goals with AI” UI.
6. **Optional**: Debt tab → “Create payoff goal” shortcut; optional reorder UI.

---

## Files to Touch

| Area | Files |
|------|--------|
| Debt payoff progress | [backend/app/api/routes/goals.py](backend/app/api/routes/goals.py) (list_goals: detect debt account, compute amount_paid and progress) |
| Delete dialog behavior | [frontend/src/components/confirm-dialog.tsx](frontend/src/components/confirm-dialog.tsx) (optional: don’t close on confirm; parent controls close), [frontend/src/app/plan/page.tsx](frontend/src/app/plan/page.tsx) (GoalsTab: pass loading, setDeleteId(null) in onSuccess) |
| Form validation & progress clamp | [frontend/src/app/plan/page.tsx](frontend/src/app/plan/page.tsx) (GoalForm, GoalCard) |
| AI suggest goals | [backend/app/api/routes/ai.py](backend/app/api/routes/ai.py) (new endpoint, prompt, schema), [frontend/src/lib/api/ai.ts](frontend/src/lib/api/ai.ts) (new method), [frontend/src/app/plan/page.tsx](frontend/src/app/plan/page.tsx) (GoalsTab: button, list of suggestions, Add/Dismiss) |

---

## Summary

- **Must-fix**: Debt payoff progress for linked debt accounts (backend + frontend clamp), delete dialog closing before request completes, form validation for non-negative amounts, progress bar 0–100 clamp.
- **Feature**: LLM-suggested goals (new AI endpoint + Goals tab UI).
- **Nice-to-have**: “Create payoff goal” from Debt tab, optional goal reorder.
