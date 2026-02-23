import api from "./client";

export interface SyncLog {
  id: string;
  household_id: string;
  provider: string;
  status: string;
  accounts_synced: number;
  transactions_imported: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SyncStatus {
  last_sync: SyncLog | null;
  is_stale: boolean;
  syncing: boolean;
}

export const syncApi = {
  status: () => api.get<SyncStatus>("/sync/status").then((r) => r.data),
  trigger: () => api.post<SyncLog>("/sync/trigger").then((r) => r.data),
  history: () => api.get<SyncLog[]>("/sync/history").then((r) => r.data),
};
