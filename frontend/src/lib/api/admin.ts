/**
 * Admin endpoints for the preview-app approval gate.
 *
 * Backed by /api/admin/* — gated server-side on role="admin". The frontend
 * hides admin UI from non-admins, but the gate is the real check.
 */
import api from "./client";

export type UserStatus = "pending" | "approved" | "rejected";

export interface AdminUserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  status: UserStatus;
  created_at: string;
}

export const adminApi = {
  /**
   * List users, optionally filtered by status. Newest first.
   *
   * @param status - "pending" | "approved" | "rejected" | undefined (all)
   */
  listUsers: (status?: UserStatus) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return api.get<AdminUserItem[]>(`/admin/users${qs}`).then((r) => r.data);
  },

  /** Flip a user's status to "approved". Idempotent (no-op if already approved). */
  approveUser: (userId: string) =>
    api.post<AdminUserItem>(`/admin/users/${encodeURIComponent(userId)}/approve`).then((r) => r.data),

  /** Flip a user's status to "rejected". Idempotent. The user keeps their account
   *  row but can't log in until re-approved. */
  rejectUser: (userId: string) =>
    api.post<AdminUserItem>(`/admin/users/${encodeURIComponent(userId)}/reject`).then((r) => r.data),
};
