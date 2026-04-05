# Design: Login backdrop — curved paths and dotted wake (Option A)

**Date:** 2026-04-05  
**Status:** Approved (conversation) — ready for implementation plan  
**Scope:** Ambient background paper planes on the login screen with a **curved dotted contrail** that appears **only behind** the plane (wake-only), using **shared SVG path geometry** — no per-frame screen sampling of many elements.

## 1. Goal and non-goals

**Goal:** Decorative motion on the login backdrop that feels light and on-brand: multiple planes follow defined curved routes; each plane shows a **dotted** trail along the **already-flown** portion of the path (typically the last _w_ units of arc length), never ahead of the nose.

**In scope:**

- Background layer behind the existing login card (does not block interaction).
- One implementation approach: **Option A** — path-native trim + dotted stroke via **mask** (see §3).
- Respect **`prefers-reduced-motion`**: disable or greatly simplify motion and trails.

**Out of scope (this spec):**

- Option B (RAF + polyline ring buffer) and Option C (canvas fade); retained only as rejected alternatives for history.
- Changing auth flows, demo mode behavior, or card layout except where the backdrop attaches.
- Loading-state / button-affordance plane animation on “Try demo” (if present later); this spec is **background planes only** unless a follow-up explicitly merges them.

## 2. Visual and motion rules

1. **Curved routes** — Each plane follows a known 2D path (Bezier / smooth segments). Production may use several named patterns (e.g. diagonal, horizontal, loop), each backed by SVG `d` (or equivalent) usable for both position and trail math.
2. **Constant perceived speed (default)** — Prefer **constant arc-length speed** along the path so `s = u · L` with linear `u` in time (unless a deliberate easing spec says otherwise).
3. **Wake-only trail** — At arc length `s` from path start, `L =` total length, wake length `w`:
   - If `s ≥ w`: stroke only `[s − w, s]`.
   - If `s < w`: stroke `[0, s]` (tail grows from the start).
4. **Dotted appearance** — Dots via a **fixed** `stroke-dasharray` on the visible trail path (e.g. `3 14`, tunable). **Do not** try to combine wake trim and dot spacing in a single `stroke-dasharray` on one stroke.
5. **Closed paths** — If a pattern is a **closed** loop, define wrap behavior for the wake when `s < w` (tail crossing the seam); open paths used for login can defer loop wrapping until a closed pattern exists.

## 3. Option A — Implementation pattern (approved)

### 3.1 Geometry

- Single authoritative path `d` per flight pattern.
- **Plane position:** `getPointAtLength(s)` (JS) or CSS **`offset-path: path('...')`** + **`offset-distance`** synced to the same progress as `s` (production choice).
- **Heading:** Tangent from `getPointAtLength(s)` and a short forward sample `getPointAtLength(s + ε)` (or `auto` with motion path where supported).

### 3.2 Dotted wake: mask + trim

1. **Visible path** — Same `d` as the plane; `fill="none"`; trail color/token; `stroke-linecap="round"`; fixed **`stroke-dasharray`** for dots (not animated for trim).
2. **Mask** — Duplicate path with:
   - **White** stroke, **wide** `stroke-width` (tunable so dots are not clipped at tight turns; mockup used ~14px mask vs ~2.5px visible stroke).
   - **`stroke-dasharray`** set to the **wake-only compound trim** (alternating dash/gap along path order):
     - `s ≥ w`: `0, (s − w), w, (L − s)` (with non-negative gaps; clamp tiny epsilon if `L − s` is 0).
     - `s < w`: `0, 0, s, (L − s)`.
3. **Mask base** — Opaque black rectangle covering the drawable area so off-wake regions hide the dotted stroke.

Each frame or keyframe tick: update **only** the mask path’s `stroke-dasharray` (and plane transform / `offset-distance`) from shared `s` (or `u` and `L`).

### 3.3 Scaling to many planes

- Reuse the same **math** per instance; vary **`d`**, **phase** (delay `u`), **duration**, and optional **opacity/scale** for depth.
- No per-plane history buffer; cost is bounded (paths × small DOM or CSS layers), not “sample 15 DOM rects per frame.”

### 3.4 Pure CSS vs minimal JS

- **Minimal JS (acceptable):** One progress value drives `s`, mask trim, and plane pose — still Option A (path-native, no polyline sampling).
- **Pure CSS:** Same trim and `offset-distance` driven by synchronized `@keyframes` / custom properties; more verbose but zero runtime JS for motion.

## 4. Integration (budget-app)

- **Placement:** Client component or layer under `frontend/src/app/login/` (or shared `components/`) so the backdrop sits behind the centered card; preserve existing gradient or blend with it per visual review.
- **Feature flag (optional):** If needed for perf or QA, mirror the pattern used elsewhere (`NEXT_PUBLIC_*`); default **on** only if perf is acceptable on target devices.

### 4.1 Sky phases (dawn, day, dusk, night) and tokens

The product targets **four** backdrop moods, not only binary light/dark. The repo today only toggles `light` | `dark` (`ThemeProvider` + `.dark` on `html`); this spec defines how planes and **dotted trails** stay on-brand when those phases exist.

**Contract (CSS custom properties):** Define login-backdrop tokens once; override them per phase. The SVG trail should use these variables (via `stroke="currentColor"` on a wrapper with `color`, or inline `style` from React reading CSS variables—avoid hard-coded mockup greens).

| Token | Role |
|--------|------|
| `--login-sky-gradient` | Page background (or layered gradients) behind the card |
| `--login-trail-stroke` | Dotted contrail color (include alpha in `oklch`/`hsl` if needed) |
| `--login-trail-width` | Visible stroke width (mask stroke scales with this + margin) |
| `--login-trail-dash` | Dot + gap pattern, e.g. `3 14` (can be one variable or two) |
| `--login-plane-fill` | Paper plane fill |
| `--login-plane-stroke` | Optional outline for contrast on bright skies |
| `--login-plane-opacity` | Depth layering for multiple planes |

**Phase selection (implementation order):**

1. **MVP:** Map `light` → `day`, `dark` → `night` tokens so trails/planes always match the current theme toggle.
2. **Full:** Set `data-login-sky="dawn" | "day" | "dusk" | "night"` on a login-only wrapper (or `html` when pathname is `/login`) from a small client hook: e.g. local clock hour buckets (document the ranges in code comments) or a later upgrade to sun times / geo. Dawn/dusk palettes sit **between** day and night for gradient and trail contrast (warmer/cooler tints, slightly different trail opacity).

**Contrast:** Trail dots must stay readable on `--login-sky-gradient` for each phase. If the gradient is busy, lower trail opacity or add a hairline stroke via token; respect **`prefers-contrast: more`** with slightly thicker `--login-trail-width` and higher-contrast `--login-trail-stroke`.

## 5. Accessibility and quality

- **`prefers-reduced-motion: reduce`:** Hide trails and pause or replace plane motion with static or nearly static treatment (e.g. single low-contrast static art).
- **`prefers-contrast: more`:** Stronger trail/plane contrast (see §4.1).
- **Pointer / focus:** Backdrop must be **`pointer-events: none`** (or equivalent) so it never steals clicks from the card.
- **Performance:** Target smooth motion on mid-tier mobile; if needed, reduce plane count, simplify paths, or disable trails on small viewports.
- **Print:** Hide or simplify animated backdrop under `@media print`.

## 6. Edge cases and failure modes

| Situation | Expected behavior |
|-----------|-------------------|
| **`getTotalLength()` is 0** (bad `d`, collapsed path) | Skip that instance; no trail; log in dev only. |
| **Loop restart** (`u` jumps 1 → 0) | Trail may “snap” empty→full; prefer **short crossfade** or **opacity dip** on reset, or **stagger** plane phases so not all reset together. |
| **Closed path, `s < w`** | Wake wraps across seam—implement explicit rule: either **two trim segments** (math heavier) or **defer closed loops** until v2; document choice in implementation plan. |
| **Tab hidden / `document.visibilityState`** | **Pause** `requestAnimationFrame` loops to avoid background CPU/battery drain. |
| **SSR / hydration** | No motion until client mount; static first paint or empty layer to avoid layout shift if dimensions fixed. |
| **Theme or `data-login-sky` changes mid-session** | Tokens update via CSS only—no cached RGB in JS for trail color unless refreshed on `MutationObserver` / effect deps. Prefer **`currentColor`** + parent `class`/`data-*` so SVG picks up new phase without prop drilling. |
| **SVG + `var()` in attributes** | Prefer `currentColor` from a tinted wrapper or `style={{ color: 'var(--login-trail-stroke)' }}` on `<g>` / parent to maximize browser support for themed strokes. |
| **Very small viewports** | Fewer planes or shorter wakes; optional `matchMedia` threshold. |
| **GPU / `will-change`** | Use sparingly on the animated layer only if profiling shows jank. |

## 7. Testing and verification

- **Manual — sky phases:** For each of **dawn, day, dusk, night** (and `light`/`dark` until full hook exists): trail readable, dots not clipped in mask at tight turns, plane visible against gradient.
- **Manual — binary theme:** Toggle light/dark; trail/plane colors update without flash of wrong theme.
- **Reduced motion / high contrast:** As above.
- **Tab switch:** Animation pauses when tab backgrounded (if using RAF).
- **Automated (optional):** Smoke test that login still renders and demo/sign-in controls remain focusable; visual regression only if the project adds it.

## 8. Reference mockup

- `docs/mockups/trail-comparison.html` — Panel **A** demonstrates wake-only **dotted** trail (mask + compound trim) aligned with this spec; panels B/C are non-normative comparisons.

## 9. Follow-up

- Implementation plan (waves + parallel Task prompts): `docs/superpowers/plans/2026-04-05-login-backdrop-plane-trail.md`.
