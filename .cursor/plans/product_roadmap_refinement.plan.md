---
name: Product roadmap refinement
overview: A focused product plan that prioritizes outcome-led activation, habit-forming dashboards, and selective AI only where it clearly outperforms rules and data alone—with explicit anti-goals to avoid AI theater.
todos:
  - id: define-wedge
    content: Pick one positioning wedge and align in-app copy (metadata, onboarding, empty states).
    status: completed
  - id: funnel-first-outcome
    content: Design/implement one first-session funnel with a single completion event to measure.
    status: completed
  - id: dashboard-nba
    content: Add state-driven “next best action” on Dashboard (sync, categorize, assign, plan).
    status: completed
  - id: deterministic-habits
    content: Ship pacing/comparison + recurring surfacing and/or trend charts before new AI surfaces.
    status: completed
  - id: ai-checklist
    content: Adopt grounded/actionable/fallback checklist for any new AI feature; prune low-value AI surfaces.
    status: completed
  - id: household-decision
    content: "Decide: single-user household only vs. shared household roadmap; align UX and comms."
    status: completed
isProject: false
---

# Product plan: meaningful depth without AI theater

## North star

**Users reach a trusted financial outcome quickly** (first budget + visibility, or a concrete debt/savings plan), then return weekly because the app answers *“what should I do next?”* with minimal friction.

## Codebase snapshot (post-implementation)

- **Activation:** [`frontend/src/components/setup-checklist.tsx`](frontend/src/components/setup-checklist.tsx) tracks account → transactions → budget assign (+ optional SimpleFIN). **Added:** `budget_first_outcome_at` in localStorage when core steps complete (for future analytics).
- **Dashboard:** **Next best action** ([`frontend/src/components/next-best-action.tsx`](frontend/src/components/next-best-action.tsx)) prioritizes stale bank sync (SimpleFIN only), uncategorized transactions, over-assignment, unassigned dollars, empty ledger. **MoM spending**, **6-month cash flow** bars, **upcoming recurring** on home.
- **Positioning:** **Clarity** — metadata, nav, login, onboarding; privacy / optional AI wedge.
- **Transactions:** `?uncategorized=1` deep-links into uncategorized filter ([`frontend/src/app/transactions/page.tsx`](frontend/src/app/transactions/page.tsx)).
- **Budget:** Horizontal scroll for category grid on narrow screens.
- **Household:** Settings → Account states single-user today.
- **AI gate:** Checklist in [`backend/app/api/routes/ai.py`](backend/app/api/routes/ai.py) module docstring; copy clarifies data-grounded / optional AI on dashboard and budget.

## Principles (including AI)

- **AI only when it earns its place:** grounded in user data, non-AI paths for the same outcomes.
- **Anti-goals:** generic tips, insights that never change, AI that only repeats charts.
- **Trust:** confirm/undo for data changes.

## Phases (summary)

| Phase | Focus |
|-------|--------|
| 1 | Activation, Clarity positioning, next best action, mobile budget scroll |
| 2 | MoM spend, recurring visibility, cash flow chart, household stance |
| 3 | Meaningful AI only (see `ai.py` checklist) |

## Success metrics (suggested)

- Activation: core setup or `budget_first_outcome_at` within 48h.
- Engagement: weekly money actions.
- AI: confirm vs undo—not chat volume.
