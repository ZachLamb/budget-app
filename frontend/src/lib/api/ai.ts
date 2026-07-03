/**
 * Types for FSA review UI and on-device scan results.
 * Server cloud routes were removed — candidates/items stay on aiApi.
 */

import api from "./client";
import type { FsaCandidatesResponse } from "../llm/contracts";
import { LLM_HTTP_TIMEOUT_MS } from "./llm-timeout";

export interface FsaEligibleTransaction {
  transaction_id: string;
  date: string;
  payee_name: string;
  category_name: string | null;
  amount: number;
  confidence: "high" | "medium" | "low";
  fsa_category: string;
  reason: string;
  status: "pending" | "claimed" | "dismissed";
}

export interface FsaReviewResponse {
  eligible_transactions: FsaEligibleTransaction[];
  total_potential_amount: number;
  scan_count: number;
  model_source: string;
  parse_errors: number;
  llm_batch_failures: number;
  candidate_count: number;
  prefilter_skipped_count: number;
}

export interface SpendingTrend {
  category: string;
  trend: "up" | "down" | "stable";
  pct_change: number;
}

export interface SpendingPatternsResponse {
  patterns: SpendingTrend[];
}

export interface BudgetSuggestion {
  category_id: string;
  category_name: string;
  suggested_amount: number;
  reasoning: string;
}

export interface AnomalyFact {
  transaction_id: string;
  category: string;
  amount: number;
  category_avg: number;
  ratio: number;
  date: string;
  payee: string | null;
}

export const aiApi = {
  getSpendingPatterns: () =>
    api.get<SpendingPatternsResponse>("/ai/facts/spending-patterns").then((r) => r.data),
  getAnomalies: () =>
    api.get<{ anomalies: AnomalyFact[] }>("/ai/facts/anomalies").then((r) => r.data),
  getFsaReviewCandidates: (params?: {
    date_from?: string;
    date_to?: string;
    include_all_outflows?: boolean;
  }) =>
    api
      .post<FsaCandidatesResponse>("/ai/fsa-review/candidates", params ?? {}, { timeout: LLM_HTTP_TIMEOUT_MS })
      .then((r) => r.data),
  updateFsaItemStatus: (transactionId: string, status: "pending" | "claimed" | "dismissed") =>
    api.patch<{ status: string }>(`/ai/fsa-review/items/${transactionId}`, { status }).then((r) => r.data),
};
