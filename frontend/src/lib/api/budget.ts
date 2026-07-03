import api from "./client";

export interface CategoryBudgetRow {
  category_id: string;
  category_name: string;
  group_id: string;
  assigned: number;
  activity: number;
  available: number;
  carryover: number;
}

export interface GroupBudgetRow {
  group_id: string;
  group_name: string;
  sort_order: number;
  is_income: boolean;
  assigned: number;
  activity: number;
  available: number;
  carryover: number;
  categories: CategoryBudgetRow[];
}

export interface BudgetMonthResponse {
  month: string;
  total_income: number;
  total_assigned: number;
  total_activity: number;
  total_available: number;
  ready_to_assign: number;
  total_carryover_in: number;
  overspend_deducted: number;
  groups: GroupBudgetRow[];
}

export interface BudgetAssignment {
  id: string;
  household_id: string;
  category_id: string;
  month: string;
  assigned_amount: number;
}

export const budgetApi = {
  getMonth: (month: string) =>
    api.get<BudgetMonthResponse>(`/budget/month/${month}`).then((r) => r.data),

  assign: (data: { category_id: string; month: string; assigned_amount: number }) =>
    api.put<BudgetAssignment>("/budget/assign", data).then((r) => r.data),

  copyMonth: (source_month: string, target_month: string) =>
    api.post<{ copied: number }>("/budget/copy-month", { source_month, target_month }).then((r) => r.data),
};
