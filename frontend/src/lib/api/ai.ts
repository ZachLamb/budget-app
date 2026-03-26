import api from "./client";

export interface AiStatus {
  ollama_available: boolean;
  claude_available: boolean;
  active_backend: string;
}

export interface InsightsResponse {
  insights: string[];
  model_source: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  reply: string;
  model_source: string;
}

export interface SpendingTrend {
  category: string;
  trend: "up" | "down" | "stable";
  pct_change: number;
}

export interface BudgetInsightsResponse {
  insights: string[];
  patterns: SpendingTrend[];
  model_source: string;
}

export interface BudgetSuggestion {
  category_id: string;
  category_name: string;
  suggested_amount: number;
  reasoning: string;
}

export interface BudgetSuggestionsResponse {
  suggestions: BudgetSuggestion[];
  model_source: string;
}

export interface DebtPlanSuggestion {
  strategy: string;
  rationale: string;
  priority_order: string[];
  monthly_extra: number;
  model_source: string;
}

export interface InterestRateSuggestion {
  account_id: string;
  account_name: string;
  suggested_apr: number;       // decimal, e.g. 0.2499
  suggested_min_payment: number;
  reasoning: string;
}

export interface InterestRateSuggestionsResponse {
  suggestions: InterestRateSuggestion[];
  model_source: string;
  note: string;
}

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
}

export const aiApi = {
  status: () => api.get<AiStatus>("/ai/status").then((r) => r.data),
  getInsights: () => api.post<InsightsResponse>("/ai/insights").then((r) => r.data),
  getBudgetInsights: () => api.post<BudgetInsightsResponse>("/ai/budget-insights").then((r) => r.data),
  getBudgetSuggestions: () => api.post<BudgetSuggestionsResponse>("/ai/budget-suggestions").then((r) => r.data),
  getDebtPlanSuggestion: () => api.post<DebtPlanSuggestion>("/ai/debt-plan-suggestion").then((r) => r.data),
  suggestInterestRates: () => api.post<InterestRateSuggestionsResponse>("/ai/suggest-interest-rates").then((r) => r.data),
  chat: (messages: ChatMessage[]) =>
    api.post<ChatResponse>("/ai/chat", { messages }).then((r) => r.data),
  getFsaReview: (params?: { date_from?: string; date_to?: string }) =>
    api.post<FsaReviewResponse>("/ai/fsa-review", params ?? {}).then((r) => r.data),
  updateFsaItemStatus: (transactionId: string, status: "pending" | "claimed" | "dismissed") =>
    api.patch<{ status: string }>(`/ai/fsa-review/items/${transactionId}`, { status }).then((r) => r.data),
};
