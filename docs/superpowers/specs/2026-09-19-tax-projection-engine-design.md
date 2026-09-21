# Phase 1 — Tax Projection Engine

Implements phase 1 of `2026-09-19-tax-platform-umbrella-design.md`. Read
that first; it carries the architecture, the phase boundaries, the
privacy rules, and the verified 2026 source figures.

## Goal

Answer "what will I owe this year, and is my withholding on track?" from
paystub actuals, and replace the hand-entered marginal rate that
currently drives the deductions summary with a computed one.

## The engine

### `inputs.py`

```python
@dataclass(frozen=True)
class TaxInputs:
    filing_status: FilingStatus
    wages_ytd: Decimal
    projected_remaining_wages: Decimal
    pretax_401k: Decimal              # reduces federal + state, NOT FICA
    pretax_hsa: Decimal               # reduces federal + state + FICA
    pretax_other: Decimal             # insurance premiums, etc.
    federal_withheld_ytd: Decimal
    state_withheld_ytd: Decimal
    ss_withheld_ytd: Decimal
    medicare_withheld_ytd: Decimal
    projected_remaining_withholding: WithholdingBuckets
    itemized_deductions: Decimal      # Schedule A style, personal
    schedule_e: ScheduleEResult | None
    prior_year_total_tax: Decimal | None
    prior_year_agi: Decimal | None
```

Deferral types are separate fields, not one total, because they hit
different tax bases. A 401(k) dollar and an HSA dollar are worth
different amounts and the engine must be able to say so — this is the
28.40% vs. 36.05% distinction from the umbrella spec.

```python
@dataclass(frozen=True)
class TaxProjection:
    agi: Decimal
    magi_for_pal: Decimal             # Pub 925 definition; see below
    deduction_taken: Decimal
    deduction_kind: Literal["standard", "itemized"]
    standard_deduction: Decimal       # both shown, so the comparison is visible
    itemized_total: Decimal
    taxable_income: Decimal
    federal_income_tax: Decimal
    social_security_tax: Decimal
    medicare_tax: Decimal
    additional_medicare_tax: Decimal
    state_tax: Decimal
    total_liability: Decimal
    total_withheld_projected: Decimal
    refund_or_amount_due: Decimal     # negative = owed
    effective_rate: Decimal
    schedule_e_allowed_loss: Decimal
    schedule_e_suspended_loss: Decimal
    safe_harbor: SafeHarborResult
    explain: list[ExplainStep]
```

`explain` carries the ordered rule-application trace that backs the
"show the work" principle. It is built by the engine, not reconstructed
by the UI.

### `engine.py`

`project(inputs, rates) -> TaxProjection`, plus:

```python
def impact_of(inputs, change: Change, rates) -> Decimal:
    """Dollars of additional tax from applying `change`. The public
    marginal-rate surface. Perturbs by the ACTUAL amount -- never by a
    fixed step, which is step-size dependent near a bracket edge."""
```

`Change` is a small sum type: extra wages, extra 401(k), extra HSA,
extra business expense, extra itemized deduction. Phase 3 consumes this
and adds no math of its own.

### `limitations.py`

Passive activity loss limitation. **The MAGI used for the phase-out
excludes the passive loss itself** (IRS Pub 925). Implementing it as
"AGI after the loss" produces a different, wrong answer — a $15,000
allowance becomes $18,000 — and creates an apparent circularity that
does not exist. This note belongs in the module docstring.

Allowance: $25,000, reduced by 50% of MAGI over $100,000, zero at
$150,000. Requires active participation. The unused portion is emitted
as `schedule_e_suspended_loss` for carryforward.

Phase 1 ships this module even though phase 2 supplies its input,
because the deductions summary needs correct business-expense valuation
immediately and `ScheduleEResult` can be populated from existing
deductible-category data in the interim.

### `safe_harbor.py`

Underpayment is generally avoided by paying the lesser of 90% of this
year's tax or 100% of last year's (110% when prior-year AGI exceeds
$150,000). Returns which test is being met, the shortfall if any, and
the per-paycheck amount that would close it. Returns "unknown" — never
"safe" — when `prior_year_total_tax` is absent, and also when
`prior_year_agi` is absent *while the prior-year test is the binding
one*.

`PriorYearReturn.agi` and `.total_tax` are independently nullable, so
partial prior-year data is an ordinary path, not an edge case. Treating
a missing AGI as "not high income" measures against 100% of prior tax
when 110% may apply — understating the requirement and permitting a
false "met", the worst output this module can produce.

The converse over-correction is also wrong: when 90%-of-current is
already the lesser figure under the 1.0x multiplier, it is lesser under
1.1x too, so the answer is certain and a missing AGI is irrelevant
there. Return "unknown" only when the prior-year test actually binds.

### `rates/`

`federal_2026.py` and `colorado_2026.py`, each figure carrying its
source URL. `registry.py` maps year to `RateSet` and raises
`UnknownTaxYearError` for any year without a table.

Rate tables are keyed by filing status for all five statuses. Phase 1
populates and tests **Single** only; the others raise a clear
"not yet supported" error rather than returning wrong numbers.

## Data model

### `TaxProfile` — replaces `TaxSettings`

| Column | Notes |
|--------|-------|
| `household_id` | FK, unique |
| `filing_status` | enum; written by the walkthrough |
| `walkthrough_answers` | JSON; the answers, not just the conclusion |
| `walkthrough_completed_at` | |
| `de_minimis_election` | bool; used by phase 2 |

Dropped: `marginal_federal_rate`, `marginal_state_rate`,
`current_federal_withholding_per_period`,
`remaining_pay_periods_this_year`. All four are now derived from
paystubs and the engine.

Pay frequency is **not** duplicated here. `Household.pay_frequency`
already exists and the current Deductions page reads it; the engine
reads it from there. This matches the 2026-09-05 spec's decision not to
duplicate it.

`FilingStatus`, `WithholdingBuckets`, `SafeHarborResult`, `ExplainStep`,
and `Change` are all defined in `inputs.py` alongside `TaxInputs`.

### `Paystub` — new, many per household per year

`pay_date`, `gross`, `pretax_401k`, `pretax_hsa`, `pretax_other`,
`federal_withheld`, `state_withheld`, `ss_withheld`,
`medicare_withheld`, and a YTD counterpart for each.

Unique on `(household_id, pay_date)`. The engine anchors on the latest
stub's YTD columns and projects forward, so a mid-year raise or a bonus
self-corrects at the next entry instead of silently poisoning the year.
This is not hypothetical for the current household: a raise from
$170,000 to $179,000 landed in August 2026, and an annual-salary model
would have been wrong for the rest of the year.

### `PriorYearReturn` — new, one per household per year

`year`, `filing_status`, `agi`, `taxable_income`, `total_tax` (Form 1040
line 24 — drives safe harbor), `total_withheld`, `itemized`,
`itemized_amount`, `schedule_e_net`, `passive_loss_carryforward`,
`capital_loss_carryforward`, `qbi_carryforward`.

No SSN, no employer, no address, no document blob.

### `Category` / `Transaction` changes

`Category.deduction_kind`: enum `business_expense | personal_itemized`,
defaulting to `personal_itemized` for existing rows. The existing
`tax_line` free-text field stays as a display label but no longer
determines valuation.

This is the fix for the umbrella spec's second proof. The two kinds are
valued through different engine paths and must not be summed together.

## Migration

`TaxSettings` -> `TaxProfile` with the four rate/withholding columns
dropped. Existing rows carry no filing status, so `filing_status` is
nullable on arrival and the Taxes page prompts for the walkthrough.

`GET /deductions/summary` keeps its current response shape so the
existing Deductions page and its tests continue to pass. Internally it
switches from flat-rate multiplication to `impact_of`, and gains
`business_total` / `personal_itemized_total` / `personal_itemized_value`
fields. Since `estimated_tax_savings` will now legitimately return
**$0** for personal deductions below the standard deduction, the
Deductions page copy must be updated in the same change to explain why —
otherwise a correct zero reads as a bug.

## API

`GET /tax/projection?year=YYYY` — assembles `TaxInputs` from the latest
paystub, profile, prior-year return, and deductions split by kind;
returns `TaxProjection`. No tax math in the route.

`GET|PUT /tax/profile`, `GET|POST|DELETE /tax/paystubs`,
`GET|PUT /tax/prior-year/{year}` — standard household-scoped CRUD,
authorized at the route layer consistent with existing routes.

`POST /tax/impact` — body describes a `Change`; returns dollars. Phase 3
builds on this; phase 1 uses it for the "what is this deduction worth"
line.

## Frontend

New **Taxes** page at `frontend/src/app/(app)/taxes/`:

- **Projection card.** Projected total tax, withheld so far, and
  refund-or-owed as the headline. Every figure expandable to its
  `explain` trace.
- **Withholding status.** Safe-harbor result in plain language, with the
  per-paycheck adjustment that closes any gap.
- **Next dollar card.** What the next $1,000 of income costs, and what a
  $1,000 deferral saves — in dollars, with the blended percentage as a
  labeled secondary.
- **Paystub list and entry form**, with the YTD columns prominent since
  those are what the engine anchors on.
- **Filing status walkthrough**, plain-language, storing answers.
- **Prior-year return form**, with a note on why each field matters.

Deductions page gains the business vs. personal split and the
standard-vs-itemized comparison.

## Error handling and degradation

| Missing | Effect |
|---------|--------|
| No paystub | Projection unavailable; page explains what to enter. Never projects from nothing. |
| No filing status | Walkthrough prompt; nothing computed. |
| No prior-year return | Everything works except safe harbor, which reports "unknown", not "safe". |
| Rate table absent for year | `UnknownTaxYearError`; page says the year is not yet supported. Never falls back to another year. |
| Filing status other than Single | Explicit "not yet supported" error. Never approximates with Single's tables. |
| Paystub YTD inconsistent with prior stubs | Flagged for confirmation rather than silently accepted. |

## Testing

- **Unit**: bracket math at every edge; SS wage base boundary; the
  Additional Medicare threshold; standard-vs-itemized selection;
  Colorado flow-through from federal taxable income; each deferral type
  against the correct tax base (401(k) must not reduce FICA).
- **Limitations**: allowance at MAGI $85k / $105k / $120k / $140k /
  $160k; the suspended-loss emission; an explicit regression test that
  MAGI excludes the passive loss.
- **Property**: additivity of `impact_of` (two $5,000 moves equal one
  $10,000 move); monotonicity of liability in income.
- **Safe harbor**: the 110% variant above $150,000 prior-year AGI, in a
  scenario where that figure is genuinely binding (not one where
  90%-of-current wins anyway); "unknown" when prior-year total tax is
  absent; AGI absent but 90%-of-current provably binds (must NOT be
  "unknown"); AGI absent and the prior-year test binds (must be
  "unknown").
- **Projection**: YTD anchoring across a mid-year raise.
- **Migration**: `TaxSettings` rows survive; the deductions summary
  response shape is unchanged.
- **Frontend**: Taxes page in each degraded state; the walkthrough
  producing Single for an unmarried filer with no dependents.
- **Back-test** (local-only, gitignored inputs): reproduce the last two
  filed returns to within tolerance of line 24.

## Acceptance

Phase 1 is done when the engine reproduces the household's last two
filed returns, the Taxes page shows a projection anchored on real
paystub YTD figures, the deductions summary no longer reports a saving
for personal deductions below the standard deduction, and every figure
on the page can be expanded to the rule that produced it.
