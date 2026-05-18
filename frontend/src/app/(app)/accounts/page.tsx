"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { syncApi } from "@/lib/api/sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, RefreshCw } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";
import { formatCurrency, formatCurrencyNegative } from "@/lib/format";
import { useIsClient } from "@/lib/hooks";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton-table";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { cn } from "@/lib/utils";
import Link from "next/link";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "loan", label: "Loan" },
  { value: "investment", label: "Investment" },
  { value: "property", label: "Property" },
];

const DEBT_TYPES = ["credit", "loan"];

function syncAgeLabel(lastSyncedAt: string | null): string | null {
  if (!lastSyncedAt) return null;
  const diffMs = Date.now() - new Date(lastSyncedAt).getTime();
  const hours = diffMs / 1000 / 3600;
  if (hours < 1) return "synced < 1h ago";
  if (hours < 24) return `synced ${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `synced ${days}d ago`;
}

function balanceColor(acct: Account): string {
  return Number(acct.balance) >= 0 ? "text-green-600" : "text-red-600";
}

function displayBalance(acct: Account): string {
  const n = Number(acct.balance);
  if (DEBT_TYPES.includes(acct.account_type)) {
    return formatCurrencyNegative(n);
  }
  return formatCurrency(n);
}

function DebtFields({ form, setField }: {
  form: { interest_rate: string; minimum_payment: string };
  setField: (k: keyof typeof form, v: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>Interest Rate (APR %)</Label>
        <div className="relative">
          <Input type="number" step="0.01" min="0" max="100" className="pr-8"
            value={form.interest_rate}
            onChange={(e) => setField("interest_rate", e.target.value)}
            placeholder="e.g. 24.99" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Minimum Monthly Payment</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input type="number" step="1" min="0" className="pl-7"
            value={form.minimum_payment}
            onChange={(e) => setField("minimum_payment", e.target.value)}
            placeholder="e.g. 25" />
        </div>
      </div>
    </>
  );
}

function AccountsContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const [createForm, setCreateForm] = useState({
    name: "",
    account_type: "checking",
    institution: "",
    starting_balance: "",
    interest_rate: "",
    minimum_payment: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    account_type: "checking",
    institution: "",
    interest_rate: "",
    minimum_payment: "",
    sync_enabled: true,
  });

  const queryClient = useQueryClient();
  const isClient = useIsClient();

  const { data: accounts = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    refetchInterval: (query) => (query.state.data?.syncing ? 3000 : 30000),
    enabled: isClient,
  });

  const createMutation = useMutation({
    mutationFn: accountsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      appToast.success("Account created");
      setCreateOpen(false);
      setCreateForm({ name: "", account_type: "checking", institution: "", starting_balance: "", interest_rate: "", minimum_payment: "" });
    },
    onError: (e) => toastApiError("Failed to create account", e),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      accountsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["debtAccounts"] });
      appToast.success("Account updated");
      setEditAccount(null);
    },
    onError: (e) => toastApiError("Failed to update account", e),
  });

  const deleteMutation = useMutation({
    mutationFn: accountsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      appToast.success("Account deleted");
    },
    onError: (e) => toastApiError("Failed to delete account", e),
  });

  const openEdit = (acct: Account) => {
    setEditAccount(acct);
    setEditForm({
      name: acct.name,
      account_type: acct.account_type,
      institution: acct.institution ?? "",
      interest_rate: acct.interest_rate != null ? (Number(acct.interest_rate) * 100).toFixed(2) : "",
      minimum_payment: acct.minimum_payment != null ? String(acct.minimum_payment) : "",
      sync_enabled: acct.sync_enabled,
    });
  };

  const saveEdit = () => {
    if (!editAccount) return;
    updateMutation.mutate({
      id: editAccount.id,
      data: {
        name: editForm.name,
        account_type: editForm.account_type,
        institution: editForm.institution || null,
        interest_rate: editForm.interest_rate ? parseFloat(editForm.interest_rate) / 100 : null,
        minimum_payment: editForm.minimum_payment ? parseFloat(editForm.minimum_payment) : null,
        sync_enabled: editForm.sync_enabled,
      },
    });
  };

  const grouped = ACCOUNT_TYPES.map((type) => ({
    ...type,
    accounts: accounts.filter((a: Account) => a.account_type === type.value),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({
                  name: createForm.name,
                  account_type: createForm.account_type,
                  institution: createForm.institution || undefined,
                  starting_balance: parseFloat(createForm.starting_balance) || 0,
                  interest_rate: createForm.interest_rate ? parseFloat(createForm.interest_rate) / 100 : undefined,
                  minimum_payment: createForm.minimum_payment ? parseFloat(createForm.minimum_payment) : undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={createForm.account_type} onValueChange={(v) => setCreateForm({ ...createForm, account_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Institution</Label>
                <Input value={createForm.institution} onChange={(e) => setCreateForm({ ...createForm, institution: e.target.value })} placeholder="e.g. Chase, Wells Fargo" />
              </div>
              <div className="space-y-2">
                <Label>Starting Balance</Label>
                <Input type="number" step="0.01" value={createForm.starting_balance} onChange={(e) => setCreateForm({ ...createForm, starting_balance: e.target.value })} />
              </div>
              {DEBT_TYPES.includes(createForm.account_type) && (
                <DebtFields
                  form={{ interest_rate: createForm.interest_rate, minimum_payment: createForm.minimum_payment }}
                  setField={(k, v) => setCreateForm({ ...createForm, [k]: v })}
                />
              )}
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Account"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        }
      />

      {syncStatus?.syncing && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 px-4 py-2.5 text-sm text-blue-800 dark:text-blue-200">
          <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
          Syncing your accounts — balances will update when complete.
        </div>
      )}

      <QueryState
        isLoading={isLoading && !accounts.length}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!isLoading && accounts.length === 0}
        emptyTitle="No accounts yet"
        emptyDescription={
          <>
            Add your first account to get started, or{" "}
            <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
              connect your bank in Settings
            </Link>{" "}
            for automatic sync.
          </>
        }
        emptyAction={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Account
          </Button>
        }
        loadingFallback={<SkeletonTable rows={4} columns={3} />}
      >
        {grouped.map((group) => (
          <Card key={group.value}>
            <CardHeader>
              <CardTitle className="text-lg">{group.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.accounts.map((acct: Account) => (
                <div key={acct.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{acct.name}</p>
                      <p className="text-sm text-muted-foreground">{acct.institution}</p>
                      {DEBT_TYPES.includes(acct.account_type) && acct.interest_rate != null && (
                        <p className="text-xs text-muted-foreground">
                          {(Number(acct.interest_rate) * 100).toFixed(2)}% APR
                          {acct.minimum_payment != null && ` · $${acct.minimum_payment} min`}
                        </p>
                      )}
                      {acct.simplefin_id && acct.last_synced_at && (
                        <p className={cn("text-xs", (() => {
                          const h = (Date.now() - new Date(acct.last_synced_at).getTime()) / 3600000;
                          return h > 24 ? "text-amber-600" : "text-muted-foreground";
                        })())}>
                          {syncAgeLabel(acct.last_synced_at)}
                          {!acct.sync_enabled && " · paused"}
                        </p>
                      )}
                      {acct.available_balance != null && DEBT_TYPES.includes(acct.account_type) && (
                        <p className="text-xs text-muted-foreground">
                          Available: {formatCurrency(Number(acct.available_balance))}
                        </p>
                      )}
                    </div>
                    {acct.simplefin_id && <Badge variant="outline" className="text-xs">{acct.sync_enabled ? "Linked" : "Paused"}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={cn("font-mono text-lg font-semibold", balanceColor(acct))}>
                      {displayBalance(acct)}
                    </p>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(acct)} className="h-8 w-8 text-muted-foreground">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(acct.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </QueryState>

      {/* Edit Account Dialog */}
      <Dialog open={!!editAccount} onOpenChange={(o) => { if (!o) setEditAccount(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={editForm.account_type} onValueChange={(v) => setEditForm({ ...editForm, account_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Institution</Label>
              <Input value={editForm.institution} onChange={(e) => setEditForm({ ...editForm, institution: e.target.value })} placeholder="e.g. Chase, Wells Fargo" />
            </div>
            {DEBT_TYPES.includes(editForm.account_type) && (
              <DebtFields
                form={{ interest_rate: editForm.interest_rate, minimum_payment: editForm.minimum_payment }}
                setField={(k, v) => setEditForm({ ...editForm, [k]: v })}
              />
            )}
            {editAccount?.simplefin_id && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sync_enabled"
                  checked={editForm.sync_enabled}
                  onChange={(e) => setEditForm({ ...editForm, sync_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 accent-primary"
                />
                <Label htmlFor="sync_enabled">Sync enabled</Label>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditAccount(null)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Account"
        description="This will permanently delete this account and all its transactions. This cannot be undone."
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
      />
    </div>
  );
}

export default function AccountsPage() {
  return <AccountsContent />;
}
