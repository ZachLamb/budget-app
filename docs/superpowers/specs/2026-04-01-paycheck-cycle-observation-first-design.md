# Design: Paycheck-cycle, observation-first budgeting, and subscription cancellation help

**Date:** 2026-04-01  
**Status:** Approved (2026-04-01) — primary time anchor: **(b) rolling window from last paycheck**  
**Scope:** Rethink default budgeting narrative away from abstract “left to assign” toward **observe → diagnose → decide** within **paycheck-to-paycheck cycles**; add a **subscription intelligence** surface (detect → confirm → cancel guidance with trustworthy links and steps).

## 1. Problem and north star

**Problem:** Labels like “$X left to assign” assume envelope budgeting literacy. Users who struggle with budgeting often need **clarity on what already happened** and **a small set of actionable levers** before envelope mechanics feel meaningful.

**North star:** The product’s default story is **“since your last income, here’s reality—here’s what you might change—here’s what you’re choosing next cycle.”** Strict allocation views remain available but are not the emotional or cognitive front door.

## 2. Principles

1. **Income-anchored windows** — Primary analytics and copy use the interval **from last confirmed paycheck (or income event) to next expected one**, with explicit dates in headers (“Mar 15 → Apr 1”).
2. **Observation before allocation** — First-class surfaces for spend truth and patterns; commitments and targets are a **later** step in the same cycle, not the opening question.
3. **Few commitments, high clarity** — Phase C emphasizes **1–3 explicit choices** (cap, cancel, move to savings) over full category grids for users in “reflective” mode.
4. **Trust over cleverness** — Subscription and cancellation help must separate **verified** paths (curated or retrieved from official sources) from **suggested** steps; never present invented URLs as facts.
5. **Coexist with power users** — Users who want classic RTA / envelope workflows can opt into or keep a **strict** mode; shared data model, different default framing and home emphasis.

## 3. Time model: paycheck cycles

### 3.1 Definition

- A **cycle** starts at a user- (or rule-) **confirmed income event** and ends at the **next expected** income date (from schedule + inferred adjustments).
- **Primary UI** scopes: spend summaries, recurring detection, subscription review, and “what changed” narratives to **the current cycle** by default.

### 3.2 Configuration (minimum viable)

- **Pay schedule:** frequency (e.g. biweekly, semi-monthly, monthly) plus anchor (next pay date or last pay date).
- **Multiple incomes:** v1 can support **one primary cycle** plus “secondary income” as tagged deposits that roll into the same window, or defer true multi-cycle until later.

### 3.3 Irregular income

- If schedule confidence is low, fall back to a **labeled rolling window** (e.g. “Last 30 days”) and prompt to **mark income** on large inflows.
- Copy must state the window plainly so users never think it’s “wrong math.”

### 3.4 Calendar month

- Retain **calendar month** where it matters: rent due dates, reporting, exports, tax-adjacent views—not as the default **behavioral** cycle for the observation-first experience.

## 4. Phases within a cycle (UX)

### 4.1 Phase A — Observe

- **Goal:** Answer “what went out the door since last pay?” without judgment framing.
- **Surfaces:** Cycle header with date range; outflow by **life areas** (mapped from categories); list of **recurring / likely subscription** charges in-window.
- **Avoid:** Leading with unassigned dollars or envelope jargon.

### 4.2 Phase B — Diagnose

- **Goal:** Answer “what’s optional, repeated, or off vs my priorities?”
- **Surfaces:** Comparison to **user-stated priorities** (lightweight: goals, tags, or pinned categories); highlights for **new merchants**, **amount spikes**, **subscription candidates**.
- **AI fit:** Interpret merchant strings, cluster duplicates, suggest “this looks like X service”—always with **confirm / dismiss / not a subscription**.

### 4.3 Phase C — Decide

- **Goal:** Answer “what do I want before next pay?”
- **Surfaces:** Short list of **commitments** for the **next** cycle (caps, cancellations, savings moves). Optional transition to **envelope / RTA** language for users in strict mode: e.g. “You planned $X for these jobs” only **after** intent is clear.

### 4.4 Entry and resume

- Opening the app **mid-cycle** resumes the appropriate phase (e.g. if user completed observe, show diagnose or decide)—not a calendar reset.

## 5. Subscription cancellation feature

### 5.1 Pipeline

1. **Detect recurrence** — Rules + time series: same normalized merchant, similar amount, interval ~weekly/monthly/annual.
2. **Enrich** — Merchant normalization; optional retrieval for “what is this?” (confidence score).
3. **Classify** — Subscription vs utility vs loan vs ambiguous; user overrides train the system.
4. **Present action cards** — Name, amount, cadence, last/next charge **in cycle context** (“hit last two pay periods”).

### 5.2 Cancellation UX

- **Preferred:** Link to **official** billing/subscription management URL when **verified** (curated table, partner data, or successful retrieval with stored provenance).
- **Instructions:** Step-by-step (“Settings → Account → Billing → Cancel”) tagged as **verified** vs **general guidance** when the product cannot verify.
- **Never:** Present LLM-hallucinated URLs as certain; use “we couldn’t verify a direct link” + safe generic steps.

### 5.3 Post-action

- User can mark **Cancelled**; optional **watch next cycle** for duplicate charges (support dispute narrative in copy only—no legal claims).

### 5.4 Privacy and safety

- Clear disclosure that enrichment may use **merchant name + amount + date** (not full account numbers) for lookup where implemented.
- No automated cancellation without explicit user action on the merchant site unless a future **verified API** exists.

## 6. Relation to existing product concepts

- **RTA / “left to assign”** — Becomes **secondary or strict-mode primary** language, not the default headline for observation-first users.
- **NBA** — Can surface deterministic items: “Unconfirmed recurring charges,” “Income date missing,” “3 subscriptions unchanged in 90 days.”
- **AI Advisor** — Natural home for “explain this charge,” “is this cancellable?,” and structured actions that **open** subscription detail or pre-fill a review list—aligned with existing evidence-bound patterns from the AI trust spec.

## 7. Approaches (recap) and recommendation

| Approach | Summary |
|----------|---------|
| **A. Observation-first dashboard** | Home = cycle spend story + recurring panel; budgeting secondary. |
| **B. Guided monthly ritual** | Explicit week-by-week checklist; stronger habit, risk of nag. |
| **C. Dual mode** | “Reflective” vs “Strict” framing; one app, two defaults. |

**Recommendation:** Implement **A** as the spine (matches paycheck cycles and user struggle), add **light ritual** entry points (single “Review this cycle” CTA), and plan **C** as settings-driven framing without doubling all screens in v1.

## 8. Phasing (implementation-oriented)

**Phase 1 — Cycle shell (no AI dependency)**  
- Income schedule + cycle date range; default charts and lists scoped to cycle; copy pass away from RTA-as-headline on home for default persona.

**Phase 2 — Recurring and subscription candidates**  
- Rule-based recurrence; confirmation UI; manual “subscription” tag.

**Phase 3 — Cancellation help**  
- Verified link/step library for top merchants; AI assists classification and drafting steps under evidence/trust rules; generic fallback path.

**Phase 4 — Decide / commitments**  
- Persist 1–3 commitments into next cycle; optional bridge to envelope targets.

## 9. Open decisions

- **Single vs multiple pay cycles** in v1 household model.
- **Whether “next pay” is inferred** from transactions only vs requires explicit schedule (recommendation: explicit schedule with smart suggestions).
- **Depth of curated cancel library** before shipping Phase 3 broadly vs merchant-long-tail AI-only with heavy disclaimers.

## 10. References

- Related: `docs/superpowers/specs/2026-04-01-ai-trust-actions-ux-design.md` (evidence, confirmation, error surfaces for AI-assisted flows).
- Implementation plan: `docs/superpowers/plans/2026-04-01-paycheck-cycle-observation-first.md`.
