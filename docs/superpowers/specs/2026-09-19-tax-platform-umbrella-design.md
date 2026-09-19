# Tax Platform — Umbrella Design

Supersedes the scope boundaries of
`2026-09-05-tax-deductions-design.md` (which remains accurate as a
description of what shipped). That spec explicitly excluded bracket
math, filing status, depreciation, and multi-year work. This one
includes all four, because the questions the user actually wants
answered cannot be answered without them:

1. What will I owe on my W2 job this year?
2. What more can I legitimately claim when I buy things for the Airbnb?
3. Where should the next dollar go?

This is **not** a tax filing tool and gives no tax advice. It computes
estimates from published rate tables and user-supplied figures, shows
its work, and says plainly when it does not know something.

## Why the existing feature must change

The shipped deductions summary multiplies a total by a hand-entered
marginal rate. Three proofs run during design show this produces wrong
numbers, not merely imprecise ones.

### Personal itemized deductions are usually worth nothing

A deduction below the standard deduction ($16,100 for a single filer in
2026) saves **zero**. The current code reports a saving anyway:

| Spent | Reported today (flat 26.4%) | Actually saved |
|-------|-----------------------------|----------------|
| $1,000 | $264 | **$0** |
| $5,000 | $1,320 | **$0** |
| $20,000 | $5,280 | $1,097 |

### Business expenses and itemized deductions are not the same thing

Schedule E rental expenses reduce income from the first dollar,
independent of whether the taxpayer itemizes (IRS Pub 527). Schedule A
itemized deductions only matter above the standard deduction. The
current model has one `deductible` flag, one free-text `tax_line`, and
one rate for both. Same dollars, different value:

| Spent | As personal itemized | As Airbnb business expense |
|-------|----------------------|----------------------------|
| $1,000 | $0 | $284 |
| $5,000 | $0 | $1,388 |
| $20,000 | $1,097 | $5,348 |

### A flat marginal rate cannot represent the real rate

Pre-tax 401(k) deferrals reduce federal and state tax but not FICA. For
the household's actual 2026 position the true value of a deferred
dollar is 28.40%, not the 36.05% marginal rate — a 26% overstatement.
Rate tables cannot express this; running the engine can.

## Architecture

The central constraint, from which everything else follows:

> **The tax engine is a pure function.** Dataclass in, dataclass out.
> No database session, no I/O, no clock.

```
backend/app/services/tax/
  rates/
    federal_2026.py     # brackets by filing status, standard deduction,
                        # SS wage base, Additional Medicare threshold
    colorado_2026.py    # flat rate, CO additions/subtractions
    registry.py         # year -> RateSet; raises on an unknown year
  inputs.py             # TaxInputs / TaxProjection dataclasses
  engine.py             # project(TaxInputs, RateSet) -> TaxProjection
  limitations.py        # passive activity loss, MAGI per Pub 925
  safe_harbor.py
```

### Marginal rates are computed, never looked up

The engine runs itself twice and differences the result. This
automatically captures bracket crossings, the Social Security wage cap,
the Additional Medicare threshold, and the passive-loss phase-out —
none of which are special-cased anywhere in the code.

Verified during design: perturbation surfaced a marginal-rate spike to
**50.25%** inside the $100k–$150k passive-loss phase-out range, versus a
24% statutory bracket. No rate-table lookup would ever show this.

**Report dollars, not rates.** A design proof showed that perturbing by
an arbitrary step gives a step-dependent answer: at wages just below a
bracket edge, the same engine reported 24.05% with a $1 step and 34.05%
with a $10,000 step. The public surface is therefore:

```python
impact_of(inputs, change) -> Decimal   # dollars, for the ACTUAL amount
```

Any percentage shown in the UI is labeled with the amount it is blended
over ("about 32% across this $5,000"). Additivity was verified: two
$5,000 moves evaluated in sequence equal one $10,000 move exactly,
which is what keeps the phase 3 ranking independent of evaluation order.

### Rate tables are versioned data, reviewed annually

One module per jurisdiction per year, every figure carrying a source URL
in a comment. `registry.py` raises on a year it has no table for rather
than silently reusing last year's brackets — a stale-rate bug would be
invisible and expensive. The 2026 federal adjustments incorporate One
Big Beautiful Bill amendments, which is exactly why these are versioned
rather than edited in place.

## Phases

Each phase ships working on its own and gets its own spec, plan, and
implementation cycle.

### Phase 1 — Tax projection engine

The pure engine, versioned rate tables, `TaxProfile`, `Paystub`,
`PriorYearReturn`, `GET /tax/projection`, and the Taxes page. Splits
`deduction_kind` into business vs. personal itemized and makes the
standard-vs-itemized comparison mandatory. Detailed in
`2026-09-19-tax-projection-engine-design.md`.

### Phase 2 — Property and Schedule E

`Property` (placed-in-service date, basis, land allocation — land is not
depreciable, and an error here misstates depreciation for 27.5 years),
`PropertyUseDays` driving a computed business-use percentage that
replaces today's hand-typed `deduction_pct`, and `DepreciableAsset` with
class, method, convention, and accumulated depreciation.

Two rules with real consequences: the 14-day / 10% personal-use test,
which caps deductions at rental income and disallows a loss when
tripped; and capitalize-vs-expense routing through the de minimis safe
harbor threshold.

### Phase 3 — Marginal-dollar optimizer

Enumerates destinations (401(k), HSA, traditional IRA, Airbnb expense
now vs. January, debt paydown, taxable savings), calls the engine once
per destination with the real amount, ranks by dollars. Includes the
true-cost calculator: a $9,000 Airbnb purchase saves $2,443.50 and
therefore costs $6,556.50. A deduction never makes a purchase free, and
the UI must say so.

Adds no tax math. It is a consumer of phase 1 and 2 only, which is why
it inherited the passive-loss cliff above without being told about it.

## Phase boundaries

Phase 2 feeds phase 1 a **structured Schedule E result**, not a scalar.
An early draft of this design claimed a single net number would do. That
was tested and failed:

| W2 wages | $18,000 rental loss usable | Error from passing the raw loss |
|----------|----------------------------|--------------------------------|
| $85,000 | $18,000 | $0 |
| $120,000 | $15,000 | $792 |
| $140,000 | $5,000 | $3,692 |
| $160,000 | $0 | **$5,112** |

The $25,000 special allowance shrinks by 50c per dollar of MAGI above
$100,000 and is gone at $150,000 (IRS Pub 925).

**Implementation note that is easy to get wrong.** The allowance depends
on MAGI and MAGI appears to depend on the loss, which looks circular.
Pub 925 defines MAGI for this purpose to **exclude the passive loss
itself**, so a single forward pass is correct and no fixed-point solve
is needed. The intuitive reading — using AGI after the loss — diverges
(a $15,000 allowance becomes $18,000) and is wrong. `limitations.py`
must carry this note.

Loss limitation is tax law, so it lives in the engine. Phase 2 computes
the rental business; phase 1 decides how much of it is usable and emits
the suspended balance that carries forward.

The boundary is therefore:

```python
@dataclass(frozen=True)
class ScheduleEResult:
    gross_rental_income: Decimal
    allowable_expenses: Decimal        # after allocation + depreciation
    net: Decimal                       # unlimited; engine applies limits
    active_participation: bool
    suspended_loss_carryin: Decimal
```

## Design principles

**Plain English throughout.** "The rate on your next dollar earned," not
"marginal rate." "Money held back from your paycheck for taxes," not
"withholding." Filing status is determined by a short walkthrough —
are you married, does anyone live with you that you support, did you pay
over half the household costs — not chosen from a dropdown. The
walkthrough stores its answers, not just its conclusion, so next year it
can ask "is this still true?" and so a surprising number can be traced
to the answer that caused it.

This is a correctness measure, not a style preference. A single filer
who selects "head of household" from a list gets a standard deduction
$8,050 too large — roughly $2,100 of phantom refund. Wrong-status is the
worst available failure mode and a dropdown invites it.

**Never fabricate a zero.** Carried forward from the 2026-09-05 spec and
extended: each output degrades independently and says what it needs.
Missing paystub, missing prior-year return, and missing property data
each disable specific outputs with specific prompts.

**Show the work.** Every projected figure can be expanded to its inputs
and the rule applied. Estimates are labeled as estimates.

## Privacy and security

Tax documents are the most sensitive records a user holds. Per the
project's standing rules:

- **Extract fields, never store the document.** Prior-year returns are
  read for a defined field list; the PDF is never persisted server-side.
- **SSN is never extracted, stored, logged, or modeled.** The engine has
  no use for it.
- **No third-party OCR or hosted model.** If extraction is automated it
  runs through the local server path already present on
  `Household.prefer_local_server`. Manual entry is a first-class option
  and the default.
- **Real returns never become committed test fixtures.** Back-testing
  reads gitignored local files; repo fixtures are synthetic or scaled.
- All new endpoints are household-scoped and authorized at the route
  layer, matching existing routes.

## Validation strategy

Unit tests against published IRS examples; property tests for
additivity and monotonicity; explicit boundary tests at every bracket
edge, the SS wage base, the Additional Medicare threshold, and both
ends of the passive-loss phase-out.

Plus a **back-test**: the engine must reproduce the household's last two
filed returns to within a small tolerance of Form 1040 line 24 before
the projection page is considered trustworthy. This is a local-only
acceptance gate, run against gitignored inputs.

## Out of scope

- Filing, e-filing, or generating IRS forms.
- Tax advice. The app computes; the user decides.
- Colorado state and local lodging/sales tax on short-term rentals — a
  separate tax regime the app does not track. Worth telling the user
  explicitly so its absence is not mistaken for coverage.
- Self-employment tax, AMT, NIIT, and equity compensation. Not needed
  for the current household; the rate-table structure accommodates them
  later.
- Filing statuses other than Single are structurally supported in the
  rate tables but not populated or tested in phase 1.

## Verified source figures (2026)

Recorded here so the spec's arithmetic is reproducible. Each is
re-verified at implementation time and carries its URL in the rate
module.

- Standard deduction, single: **$16,100**; head of household: $24,150
- Federal brackets, single: 10% / 12% over $12,400 / 22% over $50,400 /
  24% over $105,700 / 32% over $201,775 / 35% over $256,225 / 37% over
  $640,600
- Social Security wage base: **$184,500** at 6.2%
- Medicare 1.45%; Additional Medicare 0.9% over $200,000
- Colorado: **4.40% flat**, applied to federal taxable income after
  state additions and subtractions
- Passive loss special allowance: $25,000, reduced 50% of MAGI over
  $100,000, eliminated at $150,000

Sources: IRS 2026 inflation adjustments news release; IRS Pub 527; IRS
Pub 925; SSA contribution and benefit base; Colorado DOR Individual
Income Tax Guide.
