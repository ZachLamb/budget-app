# Design: AI trust, actionable completions, and UX coherence

**Date:** 2026-04-01  
**Status:** Approved (conversation) — pending implementation plan  
**Scope:** Improve grounded trust (A), action completion (B), and product coherence between Advisor, NBA, and core pages (C).

## 1. North star and principles

**North star:** Users can see why the model said something (or see that there is not enough data), complete one clear next step with confidence, and never wonder whether the floating advisor, settings, or Next Best Action is the “real” brain.

**Principles:**

1. **Evidence-bound claims** — Numeric or categorical statements reference household-scoped facts the client can surface (or the assistant asks for missing input). Honor `household.ai_enabled` and existing no-backend behavior; no fake filler when the LLM is unavailable.
2. **One confirmation surface** — Parsed actions use a consistent pattern: human-readable summary, clear confirm/cancel, predictable success and failure feedback (toasts/query invalidation aligned with app patterns).
3. **Coherent surfaces** — **Next Best Action (NBA)** remains deterministic and LLM-free. **AI Advisor** remains exploratory with optional structured actions. Copy and layout signal that distinction without feeling like two different products.

## 2. Spine: API and client contract

### 2.1 Assistant replies

- Natural language remains the primary user-facing text.
- Optional **`evidence`** (name TBD in implementation; e.g. `evidence[]`) attaches structured snippets the UI can render: budget rollups, category totals, small transaction lists, or links by id to existing views.
- Evidence is **display-only grounding** unless paired with an explicit **action**; the UI must not imply automatic writes from evidence alone.

### 2.2 Actions

- Preserve and extend the existing parse → confirm → execute flow.
- Each action includes at minimum: **action type**, **payload**, **confirmation text** (already present in product).
- Add or standardize where useful: **preconditions** (machine-checkable when possible), **idempotency** or stable keys for duplicate protection, and **post-success** behavior (which query keys to invalidate, user-visible success copy).

### 2.3 Errors

- Use a small fixed set of categories aligned with current behavior: **no AI backend**, **AI disabled for household**, **insufficient data for this question**, **parse/validation failure**, **execute failure**.
- Surface errors with the same toast/inline patterns used elsewhere (`toastApiError`, `appToast`, etc.) so failures feel like the rest of the app.

## 3. UX coherence

### 3.1 Placement

- Keep the **global FAB** for open-ended questions.
- Add **context entry points** only on high-intent views (e.g. Budget: “Explain this category”; Transactions: “Categorize similar”) so AI appears where the user’s mental model already matches “help me with this screen.”

### 3.2 NBA vs Advisor

- Shared **card** patterns and verbs (“Review,” “Apply,” “Go to…”) so both feel like one system with two engines (rules vs model).
- NBA never implies LLM reasoning; Advisor never pretends to be the only place work gets done.

### 3.3 Empty and offline states

- When no model backend is available, use **one consistent** pattern: banner and/or settings CTA, not silent empty chat-only degradation.

## 4. Phasing and testing

### 4.1 Recommended phases

**Phase 1 — Spine (thin vertical slice)**  
- Define minimal `evidence` shape and one renderer in Advisor (e.g. month/category rollup).  
- Harden action confirmation copy and error paths for one high-traffic action type.  
- Align “no backend / disabled / no data” messaging across Advisor and settings.

**Phase 2 — Context entry points**  
- One or two page-level entry points wired to the same chat or pre-filled prompt, reusing the spine.  
- NBA card visual/copy pass for parity with Advisor cards (no new NBA LLM dependency).

**Phase 3 — Depth**  
- Additional evidence types and actions; optional streaming updates to evidence if needed.  
- Analytics or logging hooks (if product requires) for confirm rate and drop-off — out of scope unless explicitly added later.

### 4.2 Testing

- **Backend:** Contract tests for chat/parse responses including `evidence` and actions; execute-action tests for success and failure classes.  
- **Frontend:** Component tests or integration tests for confirmation flow and error toasts; manual checklist for mobile FAB, escape focus, and offline banner.

### 4.3 Out of scope (for this spec)

- New cloud LLM providers or replacing Ollama as the default architecture.  
- Full redesign of navigation or non-AI pages except where needed for entry points and shared cards.

## 5. Open decisions (implementation)

- Exact JSON schema for `evidence[]` (types, max length, PII constraints).  
- Which two screens ship first as context entry points (Budget + Transactions recommended).  
- Whether evidence is generated in one LLM call or a structured follow-up — prefer **single response** with strict schema when latency allows.

---

## Spec self-review (2026-04-01)

- **Placeholders:** Section 5 explicitly lists remaining implementation choices; no “TBD” left in body without pointer.  
- **Consistency:** NBA remains non-LLM; Advisor remains LLM-backed; spine applies to both only at presentation layer.  
- **Scope:** Single implementation program with phased delivery; cloud providers explicitly excluded.  
- **Ambiguity:** “Evidence” is display-only unless paired with an action — explicit to avoid accidental auto-apply.
