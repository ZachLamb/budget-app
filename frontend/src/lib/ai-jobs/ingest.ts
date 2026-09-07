/**
 * Turn job results back into a suggestions bundle the API can apply.
 *
 * Model output is untrusted: a 7B model will confidently invent transaction
 * ids, echo a category *name* where an id belongs, or return an object where
 * an array was requested. Everything here is defensive — the backend re-checks
 * ownership anyway, but filtering client-side means the preview screen shows
 * the user real numbers instead of a pile of silent rejections.
 */

import type { ExportBundle } from "./build";
import { reconcileResults, type AiJobBundle, type AiJobResultBundle } from "./types";

export interface CategorizationSuggestion {
  transaction_id: string;
  category_id: string;
  confidence?: number;
  reason?: string;
  source?: string;
}

export interface SuggestionsBundle {
  kind: "snacksbudget.suggestions";
  schema_version: number;
  categorizations: CategorizationSuggestion[];
}

export interface IngestReport {
  suggestions: CategorizationSuggestion[];
  /** Suggestions dropped because the id wasn't in the export. */
  rejected: number;
  /** Jobs the runner reported as failed. */
  failed: number;
  /** Jobs with no result in the file. */
  missing: number;
  /** Result ids that don't correspond to any job in this batch. */
  unknown: string[];
  warnings: string[];
}

/** Coerce a model's output into the array the categorize schema asked for. */
function asRows(output: unknown): unknown[] {
  if (Array.isArray(output)) return output;
  if (typeof output === "object" && output !== null) {
    // Models frequently wrap the array in a key despite a strict schema.
    for (const key of ["suggestions", "categorizations", "results", "items"]) {
      const wrapped = (output as Record<string, unknown>)[key];
      if (Array.isArray(wrapped)) return wrapped;
    }
  }
  if (typeof output === "string") {
    try {
      return asRows(JSON.parse(output));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Map results onto suggestions, keeping only rows whose ids exist in the
 * export. `settled` suggestions (decided from history, no model involved) are
 * merged in and win over model output for the same transaction.
 */
export function ingestResults(
  exported: ExportBundle,
  bundle: AiJobBundle,
  results: AiJobResultBundle,
  settled: CategorizationSuggestion[] = [],
): IngestReport {
  const validCategories = new Set(exported.categories.map((c) => c.id));
  const validTransactions = new Set(exported.transactions.map((t) => t.id));
  const { matched, missing, unknown, failed } = reconcileResults(bundle, results);

  const byTransaction = new Map<string, CategorizationSuggestion>();
  let rejected = 0;

  for (const { job, result } of matched) {
    // A job may only answer for the transactions it was given, so one job's
    // hallucination can't overwrite another batch's work.
    const scope = new Set(
      Array.isArray(job.meta?.transactionIds)
        ? (job.meta.transactionIds as string[])
        : [],
    );
    for (const row of asRows(result.output)) {
      if (typeof row !== "object" || row === null) {
        rejected++;
        continue;
      }
      const { transaction_id: txnId, category_id: categoryId } = row as Record<
        string,
        unknown
      >;
      if (
        typeof txnId !== "string" ||
        typeof categoryId !== "string" ||
        !validTransactions.has(txnId) ||
        !validCategories.has(categoryId) ||
        (scope.size > 0 && !scope.has(txnId))
      ) {
        rejected++;
        continue;
      }
      byTransaction.set(txnId, {
        transaction_id: txnId,
        category_id: categoryId,
        source: result.model ? `lm:${result.model}` : "local-model",
      });
    }
  }

  // History-settled entries are more trustworthy than a model guess, so they
  // overwrite rather than defer.
  for (const s of settled) {
    if (validTransactions.has(s.transaction_id) && validCategories.has(s.category_id)) {
      byTransaction.set(s.transaction_id, s);
    }
  }

  const warnings: string[] = [];
  if (rejected > 0) {
    warnings.push(
      `${rejected} suggestion(s) referenced unknown transactions or categories and were dropped.`,
    );
  }
  if (failed.length > 0) {
    warnings.push(`${failed.length} job(s) failed in the runner.`);
  }
  if (missing.length > 0) {
    warnings.push(`${missing.length} job(s) had no result in the uploaded file.`);
  }
  if (unknown.length > 0) {
    warnings.push(`${unknown.length} result(s) didn't match any job in this batch.`);
  }

  return {
    suggestions: [...byTransaction.values()],
    rejected,
    failed: failed.length,
    missing: missing.length,
    unknown,
    warnings,
  };
}

/** Wrap suggestions in the envelope the import endpoints expect. */
export function toSuggestionsBundle(
  suggestions: CategorizationSuggestion[],
): SuggestionsBundle {
  return {
    kind: "snacksbudget.suggestions",
    schema_version: 1,
    categorizations: suggestions,
  };
}
