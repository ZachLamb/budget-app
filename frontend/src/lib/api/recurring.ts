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

export const recurringApi = {
  list: () => api.get<RecurringTransaction[]>("/recurring").then((r) => r.data),
  create: (data: RecurringCreate) =>
    api.post<RecurringTransaction>("/recurring", data).then((r) => r.data),
  update: (id: string, data: Partial<RecurringCreate>) =>
    api.put<RecurringTransaction>(`/recurring/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/recurring/${id}`),
};
