"use client";

/**
 * Admin-only settings card: pending user approvals and the approved-users
 * roster. Only rendered when the current user has role="admin". Hidden
 * entirely for everyone else.
 *
 * The backend gate (services.auth.admin_gate) is the load-bearing check;
 * this UI is a convenience. A non-admin who somehow rendered this would
 * still see 403s from every action button.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ShieldCheck, UserCheck, UserX, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { adminApi, type AdminUserItem } from "@/lib/api/admin";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return "—";
  }
}

function statusBadge(s: AdminUserItem["status"]) {
  if (s === "approved") return <Badge variant="secondary" className="text-xs">approved</Badge>;
  if (s === "rejected") return <Badge variant="destructive" className="text-xs">rejected</Badge>;
  return <Badge variant="outline" className="text-xs">pending</Badge>;
}

function roleBadge(role: string) {
  if (role === "admin") return <Badge className="text-xs gap-1"><ShieldCheck className="size-3" />admin</Badge>;
  return null;
}

function UserRow({
  user,
  onApprove,
  onReject,
  busy,
}: {
  user: AdminUserItem;
  onApprove: (u: AdminUserItem) => void;
  onReject: (u: AdminUserItem) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{user.name || user.email}</span>
          {statusBadge(user.status)}
          {roleBadge(user.role)}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {user.email} · created {formatRelative(user.created_at)}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        {user.status !== "approved" && (
          <Button
            size="sm"
            variant="default"
            onClick={() => onApprove(user)}
            disabled={busy}
            aria-label={`Approve ${user.email}`}
          >
            <UserCheck className="size-4" /> Approve
          </Button>
        )}
        {user.status !== "rejected" && user.role !== "admin" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(user)}
            disabled={busy}
            aria-label={`Reject ${user.email}`}
          >
            <UserX className="size-4" /> Reject
          </Button>
        )}
      </div>
    </div>
  );
}

export function AdminUsersCard() {
  const qc = useQueryClient();
  const [showApproved, setShowApproved] = useState(false);

  const allUsers = useQuery({
    queryKey: ["adminUsers", "all"],
    queryFn: () => adminApi.listUsers(),
    // Re-fetch on focus — common case: admin gets pinged about a new signup
    // request, switches tabs back to the app, expects the list to be fresh.
    refetchOnWindowFocus: true,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApi.approveUser(id),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      appToast.success(`Approved ${u.email}`);
    },
    onError: (e) => toastApiError("Approve failed", e),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => adminApi.rejectUser(id),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      appToast.success(`Rejected ${u.email}`);
    },
    onError: (e) => toastApiError("Reject failed", e),
  });

  const { pending, approved, rejected } = useMemo(() => {
    const buckets = { pending: [] as AdminUserItem[], approved: [] as AdminUserItem[], rejected: [] as AdminUserItem[] };
    for (const u of allUsers.data ?? []) {
      if (u.status === "pending") buckets.pending.push(u);
      else if (u.status === "approved") buckets.approved.push(u);
      else if (u.status === "rejected") buckets.rejected.push(u);
    }
    return buckets;
  }, [allUsers.data]);

  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" />
          User access
        </CardTitle>
        <CardDescription>
          Preview app — new sign-ups land in &quot;pending&quot; until you approve them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {allUsers.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        )}

        {allUsers.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load the user list. Refresh to try again.
          </p>
        )}

        {!allUsers.isLoading && !allUsers.isError && (
          <>
            <section>
              <header className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Pending {pending.length > 0 && <span className="text-muted-foreground">({pending.length})</span>}
                </h3>
              </header>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending requests.</p>
              ) : (
                <div className="divide-y">
                  {pending.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      onApprove={(x) => approveMut.mutate(x.id)}
                      onReject={(x) => rejectMut.mutate(x.id)}
                      busy={busy}
                    />
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section>
              <header className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-green-600" />
                  Approved ({approved.length})
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowApproved((v) => !v)}
                >
                  {showApproved ? "Hide" : "Show"}
                </Button>
              </header>
              {showApproved && (
                approved.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No approved users yet.</p>
                ) : (
                  <div className="divide-y">
                    {approved.map((u) => (
                      <UserRow
                        key={u.id}
                        user={u}
                        onApprove={(x) => approveMut.mutate(x.id)}
                        onReject={(x) => rejectMut.mutate(x.id)}
                        busy={busy}
                      />
                    ))}
                  </div>
                )
              )}
            </section>

            {rejected.length > 0 && (
              <>
                <Separator />
                <section>
                  <header className="mb-1">
                    <h3 className="text-sm font-medium">Rejected ({rejected.length})</h3>
                  </header>
                  <div className="divide-y">
                    {rejected.map((u) => (
                      <UserRow
                        key={u.id}
                        user={u}
                        onApprove={(x) => approveMut.mutate(x.id)}
                        onReject={(x) => rejectMut.mutate(x.id)}
                        busy={busy}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
