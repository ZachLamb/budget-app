# Simplified AI Settings Card

## Problem

Two issues with the current AI settings page:

1. **Broken button**: "Set up on-device AI" calls `gate.prepareFeature()`, which runs the full tier router. When WebGPU `modelSize` is `"none"` (insufficient storage) or Nano is unavailable, the router falls through to tier 4 (cloud) and opens a cloud consent dialog — wrong UX for an on-device setup button. The subsequent POST to `/api/llm/consent` returns 400.

2. **Confusing UI**: The settings card exposes too much internal complexity — three-tier status grid (Nano/WebGPU/Cloud), advanced on-device options (Lite/Decline/Reset buttons), per-feature cloud consent list with individual Authorize/Revoke/Renew buttons. Users don't need to understand tiers.

## Approach

**Approach A (selected): Minimal refactor — simplify the card only.** Keep all backend/router/consent logic unchanged. Rewrite `AiSettingsCard` to two sections and fix the button.

## Prerequisites

### Add Switch UI component

**File**: `frontend/src/components/ui/switch.tsx`

No Switch component exists in the UI library. Add a shadcn-style wrapper around `@radix-ui/react-switch` (available via the `radix-ui` package already in `package.json`). Standard API: `<Switch checked={...} onCheckedChange={...} disabled={...} />`.

## Changes

### 1. Bug fix: expose `ensureLocalSetup` on gate context

**File**: `frontend/src/lib/llm/ai-feature-gate.tsx`

- Add `ensureLocalSetup(feature: FeatureId): Promise<void>` to `AiFeatureGateContextValue`.
- Implementation delegates to `localAi.ensureReady(feature)`.
- This lets callers trigger the on-device download wizard directly, bypassing the tier router.

**File**: `frontend/src/lib/llm/ai-feature-gate.test.tsx`

- Add test: `ensureLocalSetup delegates to localAi.ensureReady` — calls `ensureLocalSetup("categorize_transaction")`, asserts `ensureReadyMock` was called with that feature.
- Add test: `ensureLocalSetup propagates rejection when user cancels` — mock `ensureReadyMock` to reject, assert the promise rejects.

### 2. Rewrite `AiSettingsCard` UI

**File**: `frontend/src/components/llm/ai-settings-card.tsx`

**On-device AI section:**
- Status line: "Model ready (1.8 GB)" / "Not downloaded" / "WebGPU not available in this browser"
- Single action button:
  - If WebGPU unavailable: no button, just the status explanation
  - If model not downloaded: "Set up on-device AI" button → calls `gate.ensureLocalSetup("categorize_transaction")`
  - If model downloaded: "Clear cached model" button → existing clear logic with confirm dialog
- No tier status grid, no advanced options panel, no Lite/Decline/Reset buttons

**Cloud AI section:**
- Description: "Off by default. Required for advanced features the small on-device model can't handle. Hosted on our private servers — never logged, never used for training."
- Privacy link
- Single Switch component: "Allow cloud AI"
  - Derived state: `isCloudEnabled = activeGrants.length > 0`
  - Toggle ON: grant ALL cloud-possible features (not just the currently-active ones), then invalidate query
  - Toggle OFF: `llmApi.revokeAllCloudConsent()`, then invalidate query
  - Loading/disabled state during mutation

**Removed from card:**
- `TierStatus` component and 3-card grid
- "Advanced on-device options" `<details>` panel (Lite model toggle, Decline download, Reset local choices)
- Per-feature consent list (`<ul>` with Authorize/Revoke/Renew per row)
- `autoSetupAttempted` ref and auto-start `useEffect`
- `setupIncomplete` warning banner
- `renewOne` and `revokeOne` mutations (replaced by bulk toggle)
- `webGpuStatusText` helper
- `formatExpiryHint` and `isWithinRenewalWindow` helpers

### 3. What stays unchanged

- `CloudConsentDialog` — still used by `prepareFeature()` for inline feature-gate prompts when features are triggered outside settings
- Per-feature backend consent endpoints and model — provides audit trail
- Router logic in `router.ts` — still picks tiers correctly at feature-use time
- 90-day expiry — still enforced server-side; the toggle re-grants all features (resetting the 90-day window)
- `useLocalAiSetup` hook and `LocalAiSetupWizard` component — unchanged, the setup button now calls them more directly
- `ConfirmDialog` for clearing the cached model — stays

## Edge Cases

### Partial grant failure on toggle-ON

Use `Promise.allSettled` instead of `Promise.all` when granting all features. If some succeed and some fail:
- Show a toast: "Cloud AI partially enabled — {N} of {total} features failed. Try again."
- Don't revert the successful grants (they're still useful).
- The query invalidation will show the actual state.

### 90-day expiry with single toggle

With per-feature UI removed, the user has no visibility into grant expiry. Fix: when the settings page loads and `isCloudEnabled` is true, silently re-grant all cloud-possible features. This resets the 90-day window for all of them. Visiting settings acts as a keep-alive. Implemented as a `useEffect` that fires once when `grants.data` is first available and `activeGrants.length > 0`.

### Indeterminate toggle state

If only some features are granted (e.g., user granted a few via inline `CloudConsentDialog` elsewhere), `isCloudEnabled = activeGrants.length > 0` shows "on". Toggling OFF then ON re-grants ALL features. This is the correct behavior — the toggle represents "cloud AI in general," not "exactly which features."

### WebGPU available but modelSize is "none"

The setup button still shows (WebGPU is available). Clicking it opens the wizard, which already handles `deviceUnsupported: modelSize === "none"` by showing a "not enough storage" message. No extra handling needed in the settings card.

## Implementation Parallelism

Three agents working on non-overlapping files:

| Agent | Files | Description |
|-------|-------|-------------|
| **A** | `ui/switch.tsx`, `ai-feature-gate.tsx`, `ai-feature-gate.test.tsx` | Add Switch component, expose `ensureLocalSetup`, add tests |
| **B** | `ai-settings-card.tsx` | Rewrite to two sections (assumes Switch + ensureLocalSetup interfaces) |
| **C** | Research only | Investigate the 400 from POST `/api/llm/consent` — check Fly logs, test locally |

## Testing

- Verify "Set up on-device AI" opens the download wizard directly (no cloud consent dialog)
- Verify cloud toggle ON grants all 9 features (check via `llmApi.listCloudConsent()`)
- Verify cloud toggle OFF revokes all (check via the list endpoint)
- Verify partial failure shows appropriate toast
- Verify page-load re-grant refreshes expiry for active grants
- Verify `CloudConsentDialog` still works when triggered inline by `prepareFeature()` from other components
- Verify existing router tests still pass (no router changes)
- Verify `ensureLocalSetup` delegates correctly in gate tests
