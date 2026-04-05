# Login backdrop — planes + dotted wake (Option A) — Implementation plan

> **For agentic workers:** Implement task-by-task; use checkboxes for tracking.

**Status:** Draft — aligns with `docs/superpowers/specs/2026-04-05-login-backdrop-plane-trail-design.md`.

**Goal:** Ship ambient paper planes on `/login` with **curved dotted contrails** (wake-only, mask + compound `stroke-dasharray` trim), styled for **dawn / day / dusk / night** via CSS tokens, with edge cases from §6 of the spec handled in code.

**Tech stack:** Next.js App Router, React, Tailwind v4, existing `ThemeProvider` (`light` | `dark`).

**Plan improvements (vs. a minimal “drop SVG on page”):**

1. **Token-first styling** — Trails never use one-off hex colors; they read `--login-trail-stroke` (and related vars) so **four sky phases** and **prefers-contrast** stay maintainable.
2. **Phased sky rollout** — MVP maps theme toggle → day/night tokens; full hook adds `data-login-sky` + hour buckets without rewriting SVG math.
3. **Operational edge cases** — Visibility pause, hydration guard, degenerate paths, and loop-reset UX are explicit tasks—not discovered at QA.

---

## Locked decisions

| Topic | Decision |
|-------|----------|
| Trail technique | **Option A** — dotted visible path + mask path with wake-only trim (spec §3.2). |
| Closed loop paths | **Defer** until v2 unless a pattern strictly needs a loop; document “open paths only” in v1. |
| Sky phase v1 source | **MVP:** `light` → day, `dark` → night. **Next:** `data-login-sky` from local hour ranges (commented thresholds); optional future sun API. |
| SVG stroke theming | Prefer **`currentColor`** on trail/plane elements with `color: var(--login-trail-stroke)` on an ancestor `<g>` / wrapper `className` so theme toggles and `data-login-sky` swaps need **no JS color cache**. |

---

## File structure (create / modify)

| Path | Responsibility |
|------|----------------|
| `frontend/src/app/globals.css` | Login sky tokens: defaults + `[data-login-sky="…"]` overrides + `@media (prefers-contrast: more)` + `@media print` |
| `frontend/src/app/login/page.tsx` | Compose backdrop + card; apply `data-login-sky` (when implemented) on wrapper |
| `frontend/src/components/login/login-backdrop.tsx` (or `login/planes-backdrop.tsx`) | Client-only SVG layer, `pointer-events: none`, planes + trails |
| `frontend/src/lib/login-sky-phase.ts` (optional) | `getLoginSkyPhase(date: Date, theme: 'light' \| 'dark'): SkyPhase` — hour buckets + theme fallback |
| `docs/mockups/trail-comparison.html` | Optional: add a **second row** or note pointing to CSS token names (non-blocking) |

---

## Phase 1 — CSS tokens and sky phases

### Task 1: Define `--login-*` variables

- [ ] In `globals.css`, add a **:root** block (or scoped under `.login-backdrop-root`) for:
  - `--login-sky-gradient` (or split `--login-sky-gradient-start` / `end` if easier for Tailwind `bg-gradient-to-*`)
  - `--login-trail-stroke`, `--login-trail-width`, `--login-trail-dash-gap` (two vars or one `stroke-dasharray` string)
  - `--login-plane-fill`, `--login-plane-stroke` (optional), `--login-mask-stroke-width` (mask fat stroke = f(`--login-trail-width`))
- [ ] Add **`[data-login-sky="dawn"]`**, **`day`**, **`dusk`**, **`night`** selectors with distinct OKLCH/HSL values tuned so **dotted trails** read clearly on each gradient (adjust opacity/tint, not only hue).
- [ ] **MVP bridge:** When `data-login-sky` is absent, set variables from **`.dark` vs not** so existing app behavior matches **night** vs **day** until the hook lands.

### Task 2: `prefers-contrast` and print

- [ ] Under `@media (prefers-contrast: more)`, bump `--login-trail-width` and increase trail/plane contrast.
- [ ] Under `@media print`, hide `.login-backdrop` (or entire animated layer).

---

## Phase 2 — Backdrop component (Option A)

### Task 3: SVG architecture

- [ ] One client component, **fixed/inset** full viewport behind content, `z-index` below card, **`pointer-events: none`**.
- [ ] Per plane instance: shared **`d`**, visible dotted path with `mask`, mask path with compound trim; plane marker (polygon or path) with tangent rotation.
- [ ] Drive `s` from one timeline per plane (phase offset `u₀`); **mask** `stroke-dasharray` updated in `requestAnimationFrame` **or** CSS `@keyframes` if you accept verbosity.

### Task 4: Edge cases in code

- [ ] **Guard:** If `getTotalLength() < ε`, skip trail + optional skip plane for that instance.
- [ ] **Visibility:** `document.visibilityState === 'hidden'` → **do not** schedule next RAF (pause); resume on `visibilitychange`.
- [ ] **Hydration:** Start RAF / CSS animation only after `useEffect` mount (no SSR mismatch).
- [ ] **Loop reset:** Stagger `u₀` across planes; optional **opacity** keyframe dip at loop boundary to soften snap (spec §6).
- [ ] **Small width:** Optional `matchMedia('(max-width: …)')` to reduce plane count or `trailFrac`.

### Task 5: Reduced motion

- [ ] `usePrefersReducedMotion()` or `matchMedia('(prefers-reduced-motion: reduce)')` → hide trails, static or no planes per spec §5.

---

## Phase 3 — Wire login page + sky hook

### Task 6: Layout and theme

- [ ] Replace or layer behind current `bg-gradient-to-br from-background to-muted` using **`--login-sky-gradient`** (Tailwind arbitrary gradient or inline `style`) so **page background** and **trail tokens** come from the same phase.
- [ ] Pass **`theme`** from `useTheme()` into sky resolver for MVP (day/night) and full (four phases).

### Task 7: `data-login-sky` hook (post-MVP)

- [ ] Implement `getLoginSkyPhase` (example hour buckets, **document in comments**): e.g. dawn 5–8, day 8–17, dusk 17–21, night 21–5 — **tune with design**.
- [ ] Set `data-login-sky` on login wrapper; ensure toggling **light/dark** still updates tokens when using MVP bridge.

---

## Phase 4 — Verification

### Task 8: Manual checklist

- [ ] **Dawn, day, dusk, night:** Trail dots visible, not clipped by mask at sharpest turn; plane readable.
- [ ] **Light/dark toggle** on `/login`: colors update without stale stroke.
- [ ] **prefers-reduced-motion:** No distracting motion.
- [ ] **prefers-contrast: more:** Thicker / higher-contrast trail.
- [ ] **Background tab:** CPU idle (DevTools Performance / no runaway RAF).
- [ ] **Print preview:** Backdrop hidden.

### Task 9: Automated (optional)

- [ ] Component test: with reduced motion mocked, backdrop renders **no** animated paths (or static layer only).
- [ ] Smoke: login page still has focusable controls (Testing Library).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| SVG `stroke="var(--x)"` inconsistent across browsers | Use **`currentColor`** + parent `color` / `className`. |
| Busy gradient eats low-opacity dots | Per-phase token tuning; slight trail opacity bump at dusk. |
| Many planes + RAF jank | Cap count; pause when hidden; profile before `will-change`. |

---

## Out of scope (this plan)

- Backend changes.
- Loading-button plane animation (separate spec if merged later).
- Sun-position API (future enhancement only).
