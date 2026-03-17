import api from "./client";

export interface FinancialGoal {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  goal_type: string; // debt_payoff | savings | emergency_fund | custom
  target_amount: number;
  current_amount: number;
  monthly_contribution: number | null;
  target_date: string | null;
  account_id: string | null;
  account_name: string | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  progress_pct: number;
  months_remaining: number | null;
}

export interface GoalCreate {
  name: string;
  description?: string;
  goal_type: string;
  target_amount: number;
  current_amount?: number;
  monthly_contribution?: number;
  target_date?: string;
  account_id?: string;
  sort_order?: number;
}

export const goalsApi = {
  list: () => api.get<FinancialGoal[]>("/goals").then((r) => r.data),
  create: (data: GoalCreate) => api.post<FinancialGoal>("/goals", data).then((r) => r.data),
  update: (id: string, data: Partial<GoalCreate & { is_completed: boolean }>) =>
    api.put<FinancialGoal>(`/goals/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/goals/${id}`),
};
