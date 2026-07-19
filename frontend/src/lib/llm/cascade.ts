/**
 * Local-first model cascade: Nano (tier 1) → WebLLM (tier 2) → optional cloud (tier 4).
 */

import { getCapability } from "./capability";
import { getLocalConsent } from "./consent";
import { OnDeviceError } from "./errors";
import type { FeatureId } from "./features";
import { decide, type RouterContext } from "./router";
import type { CapabilitySnapshot, LLMProvider } from "./types";
import { parseJsonResponse } from "./contracts";
import { maxTokensFor } from "./max-tokens";
import {
  generateVerified,
  verify,
  type Check,
  type GenerateStructuredSpec,
  type GenerateVerifiedOptions,
} from "./pipelines/steps";
import type { PipelineContext } from "./pipelines/types";
import { hasCloudConsent, streamCloudGenerate } from "./providers/cloud";

export interface CascadeProviders {
  primary: LLMProvider;
  /** Stronger on-device model when Nano verify/parse fails. */
  localFallback: LLMProvider | null;
  capability: CapabilitySnapshot;
}

const ESCALATABLE: ReadonlySet<OnDeviceError["code"]> = new Set([
  "schema_parse_failed",
  "verify_failed",
]);

/** Resolve Nano-first providers for heavy / verified pipelines. */
export async function resolveCascadeProviders(
  featureId: FeatureId,
  ctx: RouterContext,
  capability?: CapabilitySnapshot,
): Promise<CascadeProviders> {
  const cap = capability ?? (await getCapability());

  if (cap.nano.available && cap.nano.status === "available") {
    const primary = await ctx.providers.nano();
    let localFallback: LLMProvider | null = null;
    if (cap.webgpu.available && cap.webgpu.modelSize !== "none") {
      const consent = getLocalConsent();
      if (consent.downloadModel === "granted") {
        try {
          localFallback = await ctx.providers.webLlm();
        } catch {
          localFallback = null;
        }
      }
    }
    return { primary, localFallback, capability: cap };
  }

  const decision = await decide(featureId, ctx, cap);
  if (decision.kind !== "ready") {
    throw new Error(decision.message);
  }
  return {
    primary: decision.provider,
    localFallback: null,
    capability: cap,
  };
}

export interface CascadeVerifiedOptions<T> extends GenerateVerifiedOptions<T> {
  featureId: FeatureId;
  /** Retries on the primary tier before escalating (default 1 → 2 attempts). */
  primaryRetries?: number;
  /** Retries on local fallback before cloud (default 1). */
  fallbackRetries?: number;
  /**
   * User prefers their self-hosted server (LM Studio / Ollama). When set, it's
   * tried first and, on any failure (including an unreachable server), the
   * on-device cascade runs as fallback.
   */
  preferLocal?: boolean;
}

/** Run the self-hosted server and verify its structured output. */
async function generateViaLocalServer<T>(
  featureId: FeatureId,
  spec: GenerateStructuredSpec,
  checks: Check<T>[],
  opts: CascadeVerifiedOptions<T>,
): Promise<T> {
  const text = await streamCloudGenerate({
    feature: featureId,
    system: spec.system,
    prompt: spec.prompt,
    maxTokens: maxTokensFor(featureId),
    signal: opts.signal,
  });
  const parsed = parseJsonResponse(text) as T;
  const draft = opts.transform ? opts.transform(parsed) : parsed;
  return verify(draft, checks);
}

/**
 * generateVerified with escalate-on-hard: primary → local fallback → cloud (opt-in).
 * When `preferLocal` is set, the self-hosted server is tried first, then the
 * on-device cascade acts as fallback.
 */
export async function generateVerifiedWithCascade<T>(
  providers: CascadeProviders,
  featureId: FeatureId,
  spec: GenerateStructuredSpec,
  checks: Check<T>[],
  opts: CascadeVerifiedOptions<T> = { featureId },
): Promise<T> {
  const primaryRetries = opts.primaryRetries ?? 1;
  const fallbackRetries = opts.fallbackRetries ?? 1;

  // Local-server-first: try the user's own model, fall back to on-device on any
  // error (unreachable, bad JSON, verify failure) so AI never hard-fails.
  if (opts.preferLocal) {
    try {
      return await generateViaLocalServer(featureId, spec, checks, opts);
    } catch (localErr) {
      if (opts.signal?.aborted) throw localErr;
      opts.onProgress?.({
        step: "generate",
        label: "Local server unavailable — using on-device model…",
      });
    }
  }

  const tryPrimary = async (): Promise<T> =>
    generateVerified(providers.primary, spec, checks, {
      ...opts,
      retries: primaryRetries,
    });

  try {
    return await tryPrimary();
  } catch (primaryErr) {
    if (opts.signal?.aborted) throw primaryErr;
    if (
      !(primaryErr instanceof OnDeviceError) ||
      !ESCALATABLE.has(primaryErr.code)
    ) {
      throw primaryErr;
    }

    if (
      providers.localFallback &&
      providers.localFallback.tier !== providers.primary.tier
    ) {
      opts.onProgress?.({
        step: "generate",
        label: "Trying stronger on-device model…",
      });
      try {
        return await generateVerified(providers.localFallback, spec, checks, {
          ...opts,
          retries: fallbackRetries,
        });
      } catch (fallbackErr) {
        if (opts.signal?.aborted) throw fallbackErr;
        if (
          !(fallbackErr instanceof OnDeviceError) ||
          !ESCALATABLE.has(fallbackErr.code)
        ) {
          throw fallbackErr;
        }
        // fall through to cloud
      }
    }

    // Already tried the local server up front if preferred; otherwise it's the
    // opt-in escalation, which needs explicit per-feature consent.
    if (opts.preferLocal) throw primaryErr;
    const cloudOk = await hasCloudConsent(featureId);
    if (!cloudOk) throw primaryErr;

    opts.onProgress?.({
      step: "generate",
      label: "Trying cloud model (opt-in)…",
    });

    return generateViaLocalServer(featureId, spec, checks, opts);
  }
}

/** Verified generation with optional cascade from pipeline context. */
export async function runVerified<T>(
  ctx: PipelineContext,
  featureId: FeatureId,
  spec: GenerateStructuredSpec,
  checks: Check<T>[],
  opts: Omit<GenerateVerifiedOptions<T>, "signal" | "onProgress"> = {},
): Promise<T> {
  const base = {
    signal: ctx.signal,
    onProgress: ctx.onProgress,
    ...opts,
  };
  if (ctx.cascade) {
    return generateVerifiedWithCascade(ctx.cascade, featureId, spec, checks, {
      featureId,
      preferLocal: ctx.preferLocal,
      ...base,
    });
  }
  return generateVerified(ctx.provider, spec, checks, base);
}
