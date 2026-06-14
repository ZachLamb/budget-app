/**
 * Structured JSON completions for batch features (FSA, categorize).
 * Cloud fallback must use legacy REST — not Tier 4 via this module.
 */

import { isDemoMode } from "@/lib/demo-mode";
import type { FeatureId } from "./features";
import { getFeaturePolicy } from "./features";
import type { LLMProvider } from "./types";
import type { RouterContext } from "./router";
import { decide } from "./router";
import {
  demoStructuredResult,
  parseCategorizeSuggestions,
  parseFsaStructured,
  parseJsonResponse,
  StructuredParseError,
  type CategorizeSuggestion,
  type FsaStructuredResult,
} from "./contracts";
import { schemaForFeature } from "./schema";

const JSON_NUDGE = "\n\nReturn only valid JSON with no markdown fences or extra text.";

async function collectStream(
  provider: LLMProvider,
  prompt: string,
  opts: { system?: string; maxTokens?: number; signal?: AbortSignal; schema?: Record<string, unknown> },
): Promise<string> {
  let out = "";
  for await (const chunk of provider.generate(prompt, opts)) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    out += chunk;
  }
  return out;
}

export interface RunStructuredOptions {
  system: string;
  prompt: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface RunStructuredResult<T> {
  data: T;
  tier: 1 | 2;
}

async function generateStructuredOnce(
  provider: LLMProvider,
  feature: FeatureId,
  opts: RunStructuredOptions,
): Promise<string> {
  // Schema-constrained output is Nano-only (tier 1 → `responseConstraint`).
  // Tier 2 (web-llm) stays on the free-text + parseJsonResponse retry path.
  const schema = provider.tier === 1 ? schemaForFeature(feature) : undefined;
  return collectStream(provider, opts.prompt, {
    system: opts.system,
    maxTokens: opts.maxTokens ?? 2048,
    signal: opts.signal,
    schema,
  });
}

function parseForFeature(feature: FeatureId, raw: unknown): FsaStructuredResult | CategorizeSuggestion[] {
  if (feature === "fsa_review") return parseFsaStructured(raw);
  if (feature === "categorize_transaction") return parseCategorizeSuggestions(raw);
  throw new Error(`Unsupported structured feature: ${feature}`);
}

export async function runStructuredJson<T extends FsaStructuredResult | CategorizeSuggestion[]>(
  feature: FeatureId,
  ctx: RouterContext,
  opts: RunStructuredOptions,
): Promise<RunStructuredResult<T>> {
  if (isDemoMode) {
    const raw = demoStructuredResult(feature);
    return { data: parseForFeature(feature, raw) as T, tier: 2 };
  }

  const policy = getFeaturePolicy(feature);
  const decision = await decide(feature, ctx);
  if (decision.kind !== "ready") {
    throw new Error(decision.message);
  }

  const tryParse = async (provider: LLMProvider): Promise<T> => {
    let text = await generateStructuredOnce(provider, feature, opts);
    try {
      return parseForFeature(feature, parseJsonResponse(text)) as T;
    } catch (first) {
      if (opts.signal?.aborted) throw first;
      text = await generateStructuredOnce(provider, feature, {
        ...opts,
        prompt: opts.prompt + JSON_NUDGE,
      });
      try {
        return parseForFeature(feature, parseJsonResponse(text)) as T;
      } catch {
        throw new StructuredParseError(
          first instanceof Error ? first.message : "Invalid JSON from model",
          feature,
          text,
        );
      }
    }
  };

  if (decision.tier === 1 || decision.tier === 2) {
    return { data: await tryParse(decision.provider), tier: decision.tier };
  }

  // Tier 4 should not reach here for structured features — escalate to Tier 2 if allowed.
  if (policy.allowedTiers.includes(2)) {
    const capDecision = await decide(feature, {
      ...ctx,
      preferredTierByFeature: { ...ctx.preferredTierByFeature, [feature]: 2 },
    });
    if (capDecision.kind === "ready" && capDecision.tier === 2) {
      return { data: await tryParse(capDecision.provider), tier: 2 };
    }
  }

  throw new Error("Local structured AI is not available on this device.");
}

export interface BatchSpec {
  system: string;
  prompt: string;
}

export interface RunBatchedOptions {
  batches: BatchSpec[];
  signal?: AbortSignal;
  maxTokens?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface RunBatchedResult<T> {
  results: T[];
  tier: 1 | 2;
  parseErrors: number;
  batchFailures: number;
}

export async function runBatchedStructuredJson<T extends FsaStructuredResult>(
  feature: FeatureId,
  ctx: RouterContext,
  opts: RunBatchedOptions,
): Promise<RunBatchedResult<T>> {
  const results: T[] = [];
  let tier: 1 | 2 = 2;
  let parseErrors = 0;
  let batchFailures = 0;
  const total = opts.batches.length;

  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.(i, total);
    try {
      const one = await runStructuredJson<T>(feature, ctx, {
        system: opts.batches[i]!.system,
        prompt: opts.batches[i]!.prompt,
        signal: opts.signal,
        maxTokens: opts.maxTokens,
      });
      tier = one.tier;
      results.push(one.data);
    } catch (e) {
      if (opts.signal?.aborted) break;
      if (e instanceof StructuredParseError) parseErrors += 1;
      else batchFailures += 1;
    }
  }
  opts.onProgress?.(total, total);

  return { results, tier, parseErrors, batchFailures };
}

/** Mobile-friendly FSA batch sizing. */
export function fsaBatchConfig(candidateCount: number, isMobile: boolean): { batchSize: number; maxCandidates: number } {
  if (isMobile) {
    return { batchSize: 15, maxCandidates: Math.min(candidateCount, 100) };
  }
  return { batchSize: 50, maxCandidates: candidateCount };
}
