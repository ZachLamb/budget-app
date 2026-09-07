/**
 * Portable LLM job batches — hand the heavy lifting to a local model.
 *
 * Instead of exporting raw data plus prose instructions and hoping the model
 * infers what to do, we export the *calls themselves*: the exact system
 * prompt, user prompt, and JSON schema the web app would have run. A runner
 * (LM Studio, a script, a notebook) executes them and returns results keyed by
 * job id, which the app maps straight back onto its existing parsers.
 *
 * Why this shape:
 * - **Deterministic.** Each job already carries its response schema, so the
 *   result is parsed by the same code path as an in-browser run.
 * - **Model-agnostic.** Any OpenAI-compatible endpoint can execute a batch;
 *   nothing here is LM Studio specific.
 * - **Splittable.** Chrome's Gemini Nano can answer the cheap jobs in-browser
 *   and leave only the expensive ones in the exported batch.
 * - **Offline.** No network path between the browser and the model is needed,
 *   so CORS, CSP, and local-network permissions never enter into it.
 */

import type { FeatureId } from "@/lib/llm/features";

export const JOBS_KIND = "snacksbudget.jobs";
export const JOB_RESULTS_KIND = "snacksbudget.job_results";
export const JOBS_SCHEMA_VERSION = 1;

/** A single LLM call, fully specified. */
export interface AiJob {
  /** Stable id used to match a result back to this job. */
  id: string;
  /** Which app feature produced this call — selects the result parser. */
  feature: FeatureId;
  system: string;
  prompt: string;
  /**
   * JSON schema the output must satisfy. Runners should pass this as
   * `response_format: { type: "json_schema", json_schema: { schema } }`.
   * Absent for free-text features.
   */
  responseSchema?: Record<string, unknown>;
  maxTokens?: number;
  /**
   * Opaque app data echoed back on the result — e.g. which transaction ids
   * this job covers, so results can be mapped without re-deriving them.
   */
  meta?: Record<string, unknown>;
}

export interface AiJobBundle {
  kind: typeof JOBS_KIND;
  schemaVersion: number;
  createdAt: string;
  /** Hint only; a runner may use any model. */
  suggestedModel?: string;
  jobs: AiJob[];
}

export interface AiJobResult {
  id: string;
  /** Parsed JSON when the job had a schema, raw text otherwise. */
  output?: unknown;
  /** Set when the runner could not complete this job. */
  error?: string;
  /** Which model actually ran it, for provenance in the final suggestions. */
  model?: string;
}

export interface AiJobResultBundle {
  kind: typeof JOB_RESULTS_KIND;
  schemaVersion: number;
  results: AiJobResult[];
}

/** Narrow unknown parsed JSON to a results bundle. */
export function isJobResultBundle(value: unknown): value is AiJobResultBundle {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<AiJobResultBundle>;
  return (
    v.kind === JOB_RESULTS_KIND &&
    typeof v.schemaVersion === "number" &&
    Array.isArray(v.results)
  );
}

/**
 * Validate a results file and pair each result with its originating job.
 *
 * Results are untrusted input: the file may be hand-edited, produced by a
 * different batch, or contain ids that were never issued. Unknown ids are
 * reported rather than silently dropped, and every job is accounted for.
 */
export function reconcileResults(
  bundle: AiJobBundle,
  results: AiJobResultBundle,
): {
  matched: Array<{ job: AiJob; result: AiJobResult }>;
  missing: AiJob[];
  unknown: string[];
  failed: AiJobResult[];
} {
  const byId = new Map(bundle.jobs.map((j) => [j.id, j]));
  const seen = new Set<string>();
  const matched: Array<{ job: AiJob; result: AiJobResult }> = [];
  const unknown: string[] = [];
  const failed: AiJobResult[] = [];

  for (const result of results.results) {
    const job = byId.get(result.id);
    if (!job) {
      unknown.push(result.id);
      continue;
    }
    seen.add(result.id);
    if (result.error) {
      failed.push(result);
      continue;
    }
    matched.push({ job, result });
  }

  const missing = bundle.jobs.filter((j) => !seen.has(j.id));
  return { matched, missing, unknown, failed };
}
