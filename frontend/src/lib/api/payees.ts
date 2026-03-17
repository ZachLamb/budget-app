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

export const payeesApi = {
  list: (q?: string) =>
    api.get<Payee[]>("/payees", { params: q ? { q } : undefined }).then((r) => r.data),
  create: (data: PayeeCreate) => api.post<Payee>("/payees", data).then((r) => r.data),
  update: (id: string, data: Partial<PayeeCreate>) =>
    api.put<Payee>(`/payees/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/payees/${id}`),
};
