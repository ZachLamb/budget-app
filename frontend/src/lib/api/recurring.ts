import api from "./client";

export interface RecurringTransaction {
  id: string;
  household_id: string;
  payee_id: string | null;
  payee_name: string | null;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  frequency: string;
  next_date: string;
  account_id: string | null;
  account_name: string | null;
  is_subscription: boolean;
  created_at: string;
}

export interface RecurringCreate {
  payee_id?: string;
  amount: number;
  category_id?: string;
  frequency: string;
  next_date: string;
  account_id?: string;
  is_subscription?: boolean;
}

export interface RecurringSuggestion {
  dedupe_key: string;
  payee_id: string;
  payee_name: string;
  suggested_amount: number;
  suggested_frequency: string;
  occurrence_count: number;
  last_date: string;
  suggested_next_date: string;
  confidence: number;
  category_id: string | null;
  account_id: string | null;
}

export interface SubscriptionPriceChange {
  payee_name: string;
  previous_amount: number;
  current_amount: number;
  pct_change: number;
}

export const recurringApi = {
  list: () => api.get<RecurringTransaction[]>("/recurring").then((r) => r.data),
  create: (data: RecurringCreate) =>
    api.post<RecurringTransaction>("/recurring", data).then((r) => r.data),
  update: (id: string, data: Partial<RecurringCreate>) =>
    api.put<RecurringTransaction>(`/recurring/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/recurring/${id}`),
  suggestions: (lookback_days = 90) =>
    api
      .get<RecurringSuggestion[]>("/recurring/suggestions", { params: { lookback_days } })
      .then((r) => r.data),
  dismissSuggestion: (dedupe_key: string) =>
    api.post("/recurring/suggestions/dismiss", { dedupe_key }),
  priceChanges: () =>
    api.get<SubscriptionPriceChange[]>("/recurring/price-changes").then((r) => r.data),
};
