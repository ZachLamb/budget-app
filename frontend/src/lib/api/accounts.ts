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

export interface ReconcileTxnRef {
  transaction_id: string;
  date: string;
  payee_name: string | null;
  amount: string;
}

/** A concrete thing that would close the gap, and why it might. */
export interface ReconcileSuggestion {
  kind: "clear_one" | "clear_pair" | "unclear_one" | "transposition";
  explanation: string;
  transactions: ReconcileTxnRef[];
}

export interface ReconciliationView {
  account_id: string;
  statement_date: string;
  statement_balance: string;
  cleared_balance: string;
  /** statement − cleared. Positive: the bank says you have more than the
   *  app accounts for, so something is missing or not yet cleared. */
  difference: string;
  cleared_count: number;
  uncleared: ReconcileTxnRef[];
  /** null means never reconciled — not the same as reconciled to zero. */
  last_reconciled_on: string | null;
  suggestions: ReconcileSuggestion[];
  reconciled_count: number;
}

export interface ReconciliationRecord {
  id: string;
  account_id: string;
  statement_date: string;
  statement_balance: string;
  cleared_balance: string;
  difference: string;
  transaction_count: number;
  adjustment_transaction_id: string | null;
  created_at: string;
}

export const reconciliationApi = {
  view: (accountId: string, statement_date: string, statement_balance: string) =>
    api
      .get<ReconciliationView>(`/accounts/${accountId}/reconciliation`, {
        params: { statement_date, statement_balance },
      })
      .then((r) => r.data),
  history: (accountId: string) =>
    api
      .get<ReconciliationRecord[]>(`/accounts/${accountId}/reconciliations`)
      .then((r) => r.data),
  reconcile: (
    accountId: string,
    body: {
      statement_date: string;
      statement_balance: string;
      allow_difference?: boolean;
      create_adjustment?: boolean;
      adjustment_category_id?: string;
    },
  ) =>
    api
      .post<ReconciliationRecord>(`/accounts/${accountId}/reconcile`, body)
      .then((r) => r.data),
};
