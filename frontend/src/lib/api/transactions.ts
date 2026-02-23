import api from "./client";

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  payee_id: string | null;
  payee_name: string | null;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  is_split: boolean;
  parent_transaction_id: string | null;
  transfer_pair_id: string | null;
  import_id: string | null;
  created_at: string;
}

export interface TransactionList {
  transactions: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

export interface TransactionCreate {
  account_id: string;
  date: string;
  payee_name?: string;
  payee_id?: string;
  amount: number;
  category_id?: string;
  notes?: string;
  cleared?: boolean;
}

export interface TransactionFilters {
  account_id?: string;
  category_id?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  uncategorized?: boolean;
  page?: number;
  page_size?: number;
}

export const transactionsApi = {
  list: (filters?: TransactionFilters) =>
    api.get<TransactionList>("/transactions", { params: filters }).then((r) => r.data),
  get: (id: string) => api.get<Transaction>(`/transactions/${id}`).then((r) => r.data),
  create: (data: TransactionCreate) => api.post<Transaction>("/transactions", data).then((r) => r.data),
  update: (id: string, data: Partial<TransactionCreate>) =>
    api.put<Transaction>(`/transactions/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/transactions/${id}`),
};
