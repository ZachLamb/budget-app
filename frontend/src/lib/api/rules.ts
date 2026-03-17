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
}

export const rulesApi = {
  list: () => api.get<Rule[]>("/rules").then((r) => r.data),
  create: (data: RuleCreate) => api.post<Rule>("/rules", data).then((r) => r.data),
  update: (id: string, data: Partial<RuleCreate & { enabled: boolean }>) =>
    api.put<Rule>(`/rules/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/rules/${id}`),
};
