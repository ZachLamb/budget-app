/**
 * Pick the right provider for a feature given current capability + consent.
 *
 * The router never throws for "user hasn't opted in yet" — it returns a
 * structured `Decision` so callers can show the right UX (download prompt,
 * cloud consent dialog, or unavailable message).
 */

import type { CapabilitySnapshot, LLMProvider, Tier } from "./types";
import type { FeatureId, FeaturePolicy } from "./features";
import { getFeaturePolicy } from "./features";
import { getCapability } from "./capability";
import { getLocalConsent } from "./consent";

export type Decision =
  | {
      kind: "ready";
      provider: LLMProvider;
      tier: Tier;
      reason: "ok";
    }
  | {
      kind: "needs_consent";
      tier: Tier;
      reason: "needs_download_consent" | "needs_cloud_consent";
      /** Description for the UI. */
      message: string;
    }
  | {
      kind: "needs_nano_setup";
      tier: 1;
      reason: "needs_nano_setup";
      message: string;
    }
  | {
      kind: "unavailable";
      reason: "unavailable_no_capable_tier" | "ai_disabled_globally";
      message: string;
    };

export interface RouterContext {
  /** Whether the user has globally enabled AI features (settings.ai_enabled). */
  aiEnabledGlobally: boolean;
  /** Per-feature cloud consent grants from the server. */
  cloudConsentGrants: ReadonlySet<FeatureId>;
  /**
   * Optional override — force a specific tier when allowed by policy.
   * Set by the user in settings (e.g., "always cloud for explain_charge").
   */
  preferredTierByFeature?: Partial<Record<FeatureId, Tier>>;
  /**
   * Pre-built provider factories. Keep this in the router so we can
   * lazy-load Tier 2 (web-llm pulls in a large worker bundle).
   */
  providers: {
    nano: () => Promise<LLMProvider>;
    webLlm: () => Promise<LLMProvider>;
    server: () => Promise<LLMProvider>;
  };
}

/** Internal: which tiers does the device CAN serve, without considering consent? */
function capableTiers(cap: CapabilitySnapshot): Set<Tier> {
  const out = new Set<Tier>();
  if (cap.nano.available) out.add(1);
  if (cap.webgpu.available && cap.webgpu.modelSize !== "none") out.add(2);
  if (cap.server.available) out.add(4);
  return out;
}

/**
 * Pick the tier we'd *prefer* for this feature given capability + policy.
 * Doesn't consider consent — that's the next step.
 */
function pickTier(policy: FeaturePolicy, capable: Set<Tier>, override?: Tier): Tier | null {
  // Explicit user override wins as long as it's allowed and capable.
  if (override && policy.allowedTiers.includes(override) && capable.has(override)) {
    return override;
  }
  // Try default first, then walk allowed tiers from lowest (most private) to highest.
  const ordered: Tier[] = [policy.defaultTier, ...policy.allowedTiers.filter((t) => t !== policy.defaultTier).sort((a, b) => a - b)];
  for (const t of ordered) {
    if (capable.has(t)) return t;
  }
  return null;
}

export async function decide(
  featureId: FeatureId,
  ctx: RouterContext,
  capability?: CapabilitySnapshot,
): Promise<Decision> {
  if (!ctx.aiEnabledGlobally) {
    return {
      kind: "unavailable",
      reason: "ai_disabled_globally",
      message: "AI features are turned off. Enable them in Settings to continue.",
    };
  }

  const cap = capability ?? (await getCapability());
  const policy = getFeaturePolicy(featureId);
  const capable = capableTiers(cap);
  const override = ctx.preferredTierByFeature?.[featureId];
  const tier = pickTier(policy, capable, override);

  if (tier === null) {
    return {
      kind: "unavailable",
      reason: "unavailable_no_capable_tier",
      message:
        policy.minimumTier === 4
          ? "This feature requires cloud AI. Enable it in Settings."
          : "AI isn't available on this device or browser.",
    };
  }

  // Nano selected but the model isn't downloaded yet — require an explicit
  // user gesture to start the fetch (never auto-trigger Chrome's download).
  if (tier === 1 && (cap.nano.status === "downloadable" || cap.nano.status === "downloading")) {
    return {
      kind: "needs_nano_setup",
      tier: 1,
      reason: "needs_nano_setup",
      message: "On-device AI needs a quick one-time setup.",
    };
  }

  // Tier 2 needs local download consent before we instantiate the provider.
  if (tier === 2) {
    const localConsent = getLocalConsent();
    if (localConsent.downloadModel !== "granted") {
      return {
        kind: "needs_consent",
        tier: 2,
        reason: "needs_download_consent",
        message: "On-device AI needs to download a model (~1.8 GB). Continue?",
      };
    }
  }

  // Tier 4 needs server-side per-feature consent.
  if (tier === 4) {
    if (!ctx.cloudConsentGrants.has(featureId)) {
      return {
        kind: "needs_consent",
        tier: 4,
        reason: "needs_cloud_consent",
        message: "This feature uses cloud AI. Allow this question to be sent to our private cloud model?",
      };
    }
  }

  let provider: LLMProvider;
  switch (tier) {
    case 1:
      provider = await ctx.providers.nano();
      break;
    case 2:
      provider = await ctx.providers.webLlm();
      break;
    case 4:
      provider = await ctx.providers.server();
      break;
  }

  return { kind: "ready", provider, tier, reason: "ok" };
}
