import api from "./client";

export interface Payee {
  id: string;
  household_id: string;
  name: string;
  default_category_id: string | null;
  transfer_account_id: string | null;
  created_at: string;
}

export interface PayeeCreate {
  name: string;
  default_category_id?: string;
  transfer_account_id?: string;
}

export interface DuplicatePayeeMember {
  id: string;
  name: string;
}

export interface DuplicateCluster {
  normalized_key: string;
  canonical_id: string;
  canonical_name: string;
  duplicate_ids: string[];
  members: DuplicatePayeeMember[];
}

/** Per-payee totals, so the payees list can show what each one costs. */
export interface PayeeActivity {
  payee_id: string;
  name: string;
  transaction_count: number;
  /** Signed sum: negative for money out. */
  total_amount: string;
  last_date: string | null;
  top_category_id: string | null;
  top_category_name: string | null;
}

export const payeesApi = {
  list: (q?: string) =>
    api.get<Payee[]>("/payees", { params: q ? { q } : undefined }).then((r) => r.data),
  create: (data: PayeeCreate) => api.post<Payee>("/payees", data).then((r) => r.data),
  update: (id: string, data: Partial<PayeeCreate>) =>
    api.put<Payee>(`/payees/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/payees/${id}`),
  activity: () => api.get<PayeeActivity[]>("/payees/activity").then((r) => r.data),
  duplicates: () => api.get<DuplicateCluster[]>("/payees/duplicates").then((r) => r.data),
  merge: (targetId: string, sourceIds: string[]) =>
    api.post<Payee>("/payees/merge", { target_id: targetId, source_ids: sourceIds }).then((r) => r.data),
};
