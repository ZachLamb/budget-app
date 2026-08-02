import api from "./client";

import type { ExportBundle } from "@/lib/ai-jobs/build";
import type { SuggestionsBundle } from "@/lib/ai-jobs/ingest";

export interface ImportReport {
  applied: Record<string, number>;
  skipped: Record<string, number>;
  below_threshold: Record<string, number>;
  warnings: string[];
  dry_run: boolean;
}

export const aiBundleApi = {
  /** Fetch the data slice to hand to a local model. */
  export: (params: { scope?: "working_set" | "full"; months?: number } = {}) =>
    api
      .get<ExportBundle>("/ai-bundle/export", { params })
      .then((r) => r.data),

  /** Validate a suggestions bundle and report what would change. Writes nothing. */
  preview: (data: SuggestionsBundle, minConfidence = 0) =>
    api
      .post<ImportReport>("/ai-bundle/import/preview", data, {
        params: { min_confidence: minConfidence },
      })
      .then((r) => r.data),

  apply: (data: SuggestionsBundle, minConfidence = 0) =>
    api
      .post<ImportReport>("/ai-bundle/import/apply", data, {
        params: { min_confidence: minConfidence },
      })
      .then((r) => r.data),
};
