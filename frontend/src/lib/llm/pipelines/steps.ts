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
    throw new OnDeviceError("no_model", "Could not load the data to analyze.");
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

/**
 * Reflexion pass. Returns the critiqued draft as a CANDIDATE only — the caller
 * accepts it solely if it passes `verify`; otherwise it keeps the original.
 */
export async function critique<T>(
  provider: LLMProvider,
  spec: GenerateStructuredSpec,
): Promise<T> {
  return generateStructured<T>(provider, spec);
}
