# Back-test inputs

`returns.local.json` holds figures from real filed returns and is
**gitignored**. Never commit it. It carries no SSN, employer, or address —
only the numbers the engine consumes.

The back-test skips when the file is absent, so CI and other machines stay
green. Run it with:

```bash
cd backend && pytest tests/backtest/ -v
```

## What is compared against what

Each expected figure is checked against **one** engine output. The engine's
own `total_liability` is federal income tax + FICA + state tax, and no
single line on any filed form means that — comparing it to Form 1040
line 24 (federal only) would be off by the entire state and FICA bill.

| Fixture field | Engine output | Where it comes from |
|---|---|---|
| `actual_taxable_income` | `taxable_income` | Form 1040 line 15 |
| `actual_federal_income_tax` | `federal_income_tax` | Form 1040 line 16 |
| `actual_state_tax` | `state_tax` | Colorado DR 0104, net tax |
| `actual_ss_tax` | `social_security_tax` | W-2 box 4 |
| `actual_medicare_tax` | `medicare_tax` + `additional_medicare_tax` | W-2 box 6 |

Give at least one expected figure per return; a record with none fails
rather than passing on nothing. Tolerance is $25 per figure.

Form 1040 line 16 is the right federal comparison because the engine models
brackets, not credits. If the return claimed credits or owed additional
taxes, line 24 ≠ line 16 — use line 16 and expect the engine to match it.

## Where each input comes from

| Field | Source |
|-------|--------|
| `filing_status` | Form 1040, the checked box at the top |
| `wages` | **Gross** wages: W-2 box 1 **plus** box 12 code D (401k) **plus** box 12 code W (HSA) plus any other pre-tax deferral. Box 1 alone is net of deferrals and understates every figure downstream. |
| `pretax_401k` | W-2 box 12, code D |
| `pretax_hsa` | W-2 box 12, code W |
| `pretax_other` | Other pre-tax deferrals (§125 premiums, FSA) |
| `federal_withheld` | W-2 box 2 |
| `state_withheld` | W-2 box 17 |
| `ss_withheld` | W-2 box 4 |
| `medicare_withheld` | W-2 box 6 |
| `itemized_deductions` | Schedule A total, if you itemized |
| `schedule_e.*` | Schedule E page 1 |

Withholding does not affect any of the compared figures — it only moves
refund-or-owed — but it is part of the record so the same file can be used
to eyeball the refund the engine predicts.

## Format

```json
{
  "returns": [
    {
      "year": 2026,
      "filing_status": "single",
      "wages": "179000.00",
      "pretax_401k": "0.00",
      "pretax_hsa": "0.00",
      "pretax_other": "0.00",
      "federal_withheld": "31000.00",
      "state_withheld": "7000.00",
      "ss_withheld": "11098.00",
      "medicare_withheld": "2595.50",
      "itemized_deductions": "0.00",
      "schedule_e": {
        "gross_rental_income": "30000.00",
        "allowable_expenses": "22000.00",
        "net": "8000.00",
        "active_participation": true,
        "suspended_loss_carryin": "0.00"
      },
      "actual_taxable_income": "162900.00",
      "actual_federal_income_tax": "30125.00",
      "actual_state_tax": "7167.60",
      "actual_ss_tax": "11098.00",
      "actual_medicare_tax": "2595.50"
    }
  ]
}
```

A year with no rate table fails rather than skipping — add that year's
sourced rate module before back-testing against it. Phase 1 populates 2026
and `single` only; any other filing status raises rather than approximating.

## When it fails

The discrepancy is information. Read it before changing the engine, and
check in this order:

1. The input mapping above — `wages` net-of-deferrals is the usual culprit.
2. The rate table for that year.
3. Colorado: the engine applies a flat rate to *federal* taxable income. A
   return with state additions or subtractions will differ, and that is a
   modelling gap to record, not a bug to patch away.
