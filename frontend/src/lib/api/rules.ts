import api from "./client";

export interface Rule {
  id: string;
  household_id: string;
  priority: number;
  match_field: string;
  match_type: string;
  match_value: string;
  category_id: string;
  source: string;
  enabled: boolean;
  created_at: string;
}

export interface RuleCreate {
  match_field: string;
  match_type: string;
  match_value: string;
  category_id: string;
  priority?: number;
  source?: string;
}

export interface RuleSuggestion {
  match_field: string;
  match_type: string;
  match_value: string;
  category_id: string;
  category_name: string;
  support: number;
  total: number;
  dominance: number;
}

export interface RuleMatch {
  transaction_id: string;
  date: string;
  payee_name: string | null;
  amount: string;
  /** The text the rule matched against, so a surprising match is explicable. */
  matched_on: string;
  rule_id: string;
  category_id: string;
}

export interface RulePreview {
  total: number;
  sample: RuleMatch[];
}

/** A rule being typed, before it exists. The category is not part of the
 *  question: which transactions a pattern claims does not depend on it. */
export interface RuleCandidate {
  match_field: string;
  match_type: string;
  match_value: string;
}

export const rulesApi = {
  list: () => api.get<Rule[]>("/rules").then((r) => r.data),
  create: (data: RuleCreate) => api.post<Rule>("/rules", data).then((r) => r.data),
  update: (id: string, data: Partial<RuleCreate & { enabled: boolean }>) =>
    api.put<Rule>(`/rules/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/rules/${id}`),
  suggestions: () => api.get<RuleSuggestion[]>("/rules/suggestions").then((r) => r.data),
  previewAll: () => api.get<RulePreview>("/rules/preview").then((r) => r.data),
  previewRule: (id: string) =>
    api.get<RulePreview>(`/rules/${id}/preview`).then((r) => r.data),
  previewCandidate: (candidate: RuleCandidate) =>
    api.post<RulePreview>("/rules/preview", candidate).then((r) => r.data),
  applyRule: (id: string) =>
    api.post<{ categorized: number }>(`/rules/${id}/apply`).then((r) => r.data),
};
