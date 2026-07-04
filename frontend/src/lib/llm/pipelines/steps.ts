import api from "@/lib/api/client";
import { parseJsonResponse } from "../contracts";
import { OnDeviceError } from "../errors";
import type { GenerateOptions, LLMProvider } from "../types";

/**
 * Fetch a grounded fact payload from a backend fact endpoint. The path is
 * relative to `/api` (the shared client prepends it), e.g. `/ai/facts/budget`.
 */
export async function ground<T>(
  factPath: string,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const r = await api.get<T>(factPath, { signal });
    return r.data;
  } catch {
    if (signal?.aborted) {
      throw new OnDeviceError("aborted", "Cancelled.");
    }
    throw new OnDeviceError("facts_unavailable", "Could not load the data to analyze.");
  }
}

export interface GenerateStructuredSpec {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

/**
 * Run one schema-constrained generation and parse the JSON result. Schema is
 * only forwarded to Tier-1 (Nano `responseConstraint`); other tiers parse free
 * text. Throws `schema_parse_failed` when the output isn't valid JSON.
 */
export async function generateStructured<T = unknown>(
  provider: LLMProvider,
  spec: GenerateStructuredSpec,
): Promise<T> {
  const opts: GenerateOptions = {
    system: spec.system,
    schema: provider.tier === 1 ? spec.schema : undefined,
    temperature: spec.temperature,
    topK: spec.topK,
    signal: spec.signal,
  };
  let out = "";
  for await (const chunk of provider.generate(spec.prompt, opts)) out += chunk;
  try {
    return parseJsonResponse(out) as T;
  } catch {
    throw new OnDeviceError(
      "schema_parse_failed",
      "Model returned malformed output.",
    );
  }
}

export type Check<T> = (result: T) => boolean;

/**
 * Deterministic verifier — the source of truth. Returns the result if every
 * check passes; throws `verify_failed` otherwise. The model is never trusted
 * over these checks.
 */
export function verify<T>(result: T, checks: Check<T>[]): T {
  for (const check of checks) {
    if (!check(result)) {
      throw new OnDeviceError("verify_failed", "Result failed verification.");
    }
  }
  return result;
}

export interface GenerateVerifiedOptions<T> {
  /** Total attempts = retries + 1. Default 2 (i.e. 3 attempts). */
  retries?: number;
  signal?: AbortSignal;
  /** Post-process the parsed draft before verification (e.g. force fields). */
  transform?: (draft: T) => T;
}

/**
 * generate → (transform) → verify with bounded retries. Retries on BOTH
 * malformed output (`schema_parse_failed`) and failed verification
 * (`verify_failed`) so a transient bad generation is given another chance.
 * Aborts propagate immediately. After the last attempt the most recent
 * `OnDeviceError` is rethrown so the caller sees the real cause.
 */
export async function generateVerified<T>(
  provider: LLMProvider,
  spec: GenerateStructuredSpec,
  checks: Check<T>[],
  opts: GenerateVerifiedOptions<T> = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      throw new OnDeviceError("aborted", "Cancelled.");
    }
    try {
      const generated = (await generateStructured<T>(provider, spec)) as T;
      const draft = opts.transform ? opts.transform(generated) : generated;
      return verify(draft, checks);
    } catch (e) {
      if (opts.signal?.aborted) {
        throw new OnDeviceError("aborted", "Cancelled.");
      }
      lastErr = e;
    }
  }
  if (lastErr instanceof OnDeviceError) throw lastErr;
  throw new OnDeviceError("verify_failed", "Result failed verification.");
}
