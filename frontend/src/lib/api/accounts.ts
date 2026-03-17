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

/** In the browser, use fetch with a literal relative URL so the request never goes to backend:8000. */
async function listAccounts(): Promise<Account[]> {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/accounts", {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const body = await res.text();
      let msg = body;
      try {
        const j = JSON.parse(body);
        if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {
        /* ignore */
      }
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return res.json();
  }
  return api.get<Account[]>("/accounts").then((r) => r.data);
}

export const accountsApi = {
  list: listAccounts,
  get: (id: string) => api.get<Account>(`/accounts/${id}`).then((r) => r.data),
  create: (data: AccountCreate) => api.post<Account>("/accounts", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => api.put<Account>(`/accounts/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
};
