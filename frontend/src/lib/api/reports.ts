import api from "./client";

export interface SpendingByCategory {
  category_id: string;
  category_name: string;
  group_name: string;
  total: number;
}

export interface SpendingByMonth {
  month: string;
  expenses: number;
  income: number;
  net: number;
}

export interface TopPayee {
  payee_name: string;
  total: number;
  count: number;
}

export interface ImportRecord {
  id: string;
  account_name: string;
  source: string;
  filename: string | null;
  transaction_count: number;
  imported_at: string;
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface LlmSuggestion {
  transaction_id: string;
  suggested_category_id: string;
  payee_name: string;
  category_name: string;
}

export const reportsApi = {
  spendingByCategory: (params?: { month?: string; date_from?: string; date_to?: string }) =>
    api.get<SpendingByCategory[]>("/reports/spending-by-category", { params }).then((r) => r.data),

  spendingByMonth: (months?: number) =>
    api.get<SpendingByMonth[]>("/reports/spending-by-month", { params: { months } }).then((r) => r.data),

  topPayees: (params?: { month?: string; limit?: number }) =>
    api.get<TopPayee[]>("/reports/top-payees", { params }).then((r) => r.data),

  imports: () => api.get<ImportRecord[]>("/reports/imports").then((r) => r.data),

  balanceHistory: (accountId: string) =>
    api.get<BalancePoint[]>(`/reports/accounts/${accountId}/balance-history`).then((r) => r.data),

  suggestCategories: () =>
    api.post<{ suggestions: LlmSuggestion[] }>("/categorization/suggest").then((r) => r.data),

  applySuggestions: (suggestions: { transaction_id: string; category_id: string }[]) =>
    api.post("/categorization/apply", { suggestions }).then((r) => r.data),

  applyRules: () => api.post("/categorization/apply-rules").then((r) => r.data),

  exportCsv: (params?: { account_id?: string; date_from?: string; date_to?: string }) =>
    api.get("/transactions/export/csv", { params, responseType: "blob" }).then((r) => r.data),
};
