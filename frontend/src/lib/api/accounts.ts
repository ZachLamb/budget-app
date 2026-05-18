import api from "./client";

export interface Account {
  id: string;
  household_id: string;
  name: string;
  account_type: string;
  institution: string | null;
  currency: string;
  is_budget_account: boolean;
  simplefin_id: string | null;
  closed_at: string | null;
  created_at: string;
  balance: number;
  interest_rate: number | null;
  minimum_payment: number | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  available_balance: number | null;
}

export interface AccountCreate {
  name: string;
  account_type: string;
  institution?: string;
  currency?: string;
  is_budget_account?: boolean;
  starting_balance?: number;
  interest_rate?: number;
  minimum_payment?: number;
}

async function listAccounts(): Promise<Account[]> {
  return api.get<Account[]>("/accounts").then((r) => r.data);
}

export const accountsApi = {
  list: listAccounts,
  get: (id: string) => api.get<Account>(`/accounts/${id}`).then((r) => r.data),
  create: (data: AccountCreate) => api.post<Account>("/accounts", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => api.put<Account>(`/accounts/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
};
