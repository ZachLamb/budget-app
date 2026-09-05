# Tax Deductions Tracking — Design Spec

## Purpose

Bring last year's manual tax-prep workflow (tracking rental/Airbnb business
expenses and personal itemized deductions from receipts) into the budget
app, so deductions build up automatically from categorized transactions
throughout the year instead of being reconstructed at tax time. The goal
is visibility into an estimated tax bill and, optionally, a rough nudge on
whether current paycheck withholding is higher than it needs to be.

This is explicitly **not** a tax-filing or tax-advice tool. All rate
inputs are manually entered by the user; the app does no bracket
computation and gives no filing guidance — it does arithmetic on numbers
the user supplies.

## Scope

Covers both:
- **Rental/business deductions** (Schedule E-style): cleaning, repairs,
  utilities, supplies tied to the rental unit.
- **Personal itemized deductions** (Schedule A-style) and partial-use
  deductions (e.g. home-office percentage of a streaming or utility
  bill).

Both are modeled the same way: a category (or an individual transaction)
is flagged deductible with a percentage and a free-text tax line label.

## Data Model

### `Category` (existing table, new columns)
- `deductible: bool` (default `false`)
- `deduction_pct: Numeric(5,2)` (default `100.00`) — percent of any
  transaction in this category that counts as deductible.
- `tax_line: str | null` — free-text label shown in the summary, e.g.
  `"Schedule E — Cleaning"` or `"Schedule A — Medical"`. Not validated
  against a fixed list; the user chooses their own labels.

`CategoryGroup` is not extended — category-level granularity is
sufficient and avoids a second place to configure the same thing.

### `Transaction` (existing table, new column)
- `deduction_pct_override: Numeric(5,2) | null` — when set, overrides
  the category's `deduction_pct` for this one transaction (e.g. a
  category is normally 100% deductible but one transaction in it was
  personal use). When `null`, the category's value applies.

A transaction counts toward deductions only if its category has
`deductible = true`. The override changes the *percentage*, not whether
it counts at all — to exclude a single transaction entirely, the user
sets its override to `0`.

### `TaxSettings` (new table, one row per household)
- `id`, `household_id` (FK, unique)
- `marginal_federal_rate: Numeric(5,2) | null`
- `marginal_state_rate: Numeric(5,2) | null`
- `pay_frequency: str | null` (`weekly` / `biweekly` / `semimonthly` /
  `monthly`)
- `current_federal_withholding_per_period: Numeric(10,2) | null`
- `remaining_pay_periods_this_year: int | null`

All fields nullable — the feature degrades gracefully (see below) when
settings are incomplete. This table holds no income, employer, or SSN
data — only self-reported rate and withholding inputs the user chooses
to enter.

## Backend

### `PATCH /categories/{id}`
Extend the existing update schema to accept `deductible`,
`deduction_pct`, `tax_line`. No change to existing fields or behavior.

### `PATCH /transactions/{id}`
Extend to accept `deduction_pct_override`.

### `GET /tax-settings` / `PUT /tax-settings`
Simple get/upsert for the household's `TaxSettings` row.

### `GET /deductions/summary?year=YYYY`
- Query all transactions in `year` whose category has `deductible = true`.
- Per transaction: `amount * (deduction_pct_override ?? category.deduction_pct) / 100`.
- Group by `tax_line` (falling back to category name if `tax_line` is
  unset), sum per group, and compute a grand total.
- If `TaxSettings.marginal_federal_rate` and `marginal_state_rate` are
  both set: `estimated_tax_savings = grand_total * (federal_rate + state_rate) / 100`.
  Otherwise omit this field from the response (not zero — genuinely
  absent, so the frontend can show "add your rate to see an estimate"
  instead of a misleading $0).
- If `estimated_tax_savings` is present **and**
  `current_federal_withholding_per_period` and
  `remaining_pay_periods_this_year` are both set and the latter is
  `> 0`: `suggested_withholding_reduction_per_period = estimated_tax_savings / remaining_pay_periods_this_year`.
  Otherwise omit.

Response shape:
```json
{
  "year": 2026,
  "lines": [
    {"tax_line": "Schedule E — Cleaning", "amount": 1240.00},
    {"tax_line": "Schedule E — Utilities", "amount": 610.00},
    {"tax_line": "Schedule A — Medical", "amount": 340.00}
  ],
  "total": 2190.00,
  "estimated_tax_savings": 482.80,
  "suggested_withholding_reduction_per_period": 26.82
}
```

## Frontend

- **Category edit modal**: add a "Tax deductible" toggle, a percent
  input (shown only when the toggle is on, default 100), and a tax-line
  text field.
- **Transaction row/detail**: add an optional "override deduction %"
  field, visible only for transactions in a deductible category.
- **New "Deductions" page**:
  - Summary table matching the approved mock (line items, total).
  - "Estimated tax savings" line, shown only when settings support it;
    otherwise a prompt linking to the settings form.
  - Settings card: marginal federal/state rate, pay frequency, current
    per-paycheck federal withholding, remaining pay periods.
  - Withholding nudge line, shown only when computable, phrased as an
    estimate ("you could consider reducing withholding by ~$X/paycheck
    for the rest of the year") with a one-line disclaimer that this is
    not tax advice.

## Error Handling / Edge Cases

- No deductible categories yet → summary page shows an empty state
  pointing at category settings.
- `TaxSettings` missing or partially filled → summary/savings/nudge
  degrade independently as described above; never show a fabricated
  $0.
- `remaining_pay_periods_this_year <= 0` → nudge omitted rather than
  showing a divide-by-zero or negative number.
- Negative transaction amounts (refunds/credits) in a deductible
  category net out normally in the sum — no special-casing.

## Testing

- Backend (pytest): aggregation math (pct + override interaction),
  grouping/fallback to category name when `tax_line` unset, savings
  calculation present/absent based on settings completeness,
  withholding nudge present/absent logic, `PATCH` schema extensions.
- Frontend: component tests for the Deductions page in three states
  (no settings, partial settings, full settings), and for the category
  modal's new fields.

## Out of Scope

- Any IRS bracket table or filing-status-driven rate computation —
  rates are always manually entered.
- Multi-year comparison or amortized deductions (e.g. depreciation
  schedules) — out of scope for this iteration.
- Automatic categorization changes based on deduction status — deciding
  what's deductible remains a manual, per-category choice.
