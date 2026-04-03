import api from "./client";

export type CommitmentKind = "cap" | "cancel" | "save" | "custom";
export type CommitmentStatus = "active" | "done" | "dismissed";

export interface CycleCommitment {
  id: string;
  household_id: string;
  cycle_start_date: string;
  cycle_end_date: string;
  title: string;
  kind: string;
  payload: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export const cycleCommitmentsApi = {
  list: () => api.get<CycleCommitment[]>("/cycle-commitments").then((r) => r.data),
  create: (data: { title: string; kind: CommitmentKind }) =>
    api.post<CycleCommitment>("/cycle-commitments", data).then((r) => r.data),
  update: (id: string, data: { title?: string; status?: CommitmentStatus }) =>
    api.patch<CycleCommitment>(`/cycle-commitments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/cycle-commitments/${id}`),
};
