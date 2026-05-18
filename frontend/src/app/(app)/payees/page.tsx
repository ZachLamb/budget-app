"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { payeesApi, type Payee, type PayeeCreate } from "@/lib/api/payees";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { useFlatCategories, useIsClient } from "@/lib/hooks";
import { toastApiError } from "@/lib/toast-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Search, Pencil } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton-table";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";

function PayeesContent() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<PayeeCreate>({ name: "" });

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const { data: payees = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["payees", search],
    queryFn: () => payeesApi.list(search || undefined),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });

  const { allCategories, catNameMap } = useFlatCategories();
  const acctNameMap = Object.fromEntries(accounts.map((a: Account) => [a.id, a.name]));

  const createMutation = useMutation({
    mutationFn: payeesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payees"] });
      appToast.success("Payee created");
      setAddOpen(false);
      setForm({ name: "" });
    },
    onError: (e) => toastApiError("Failed to create payee", e),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PayeeCreate> }) => payeesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payees"] });
      appToast.success("Payee updated");
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: payeesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payees"] });
      appToast.success("Payee deleted");
    },
    onError: (e) => toastApiError("Failed to delete payee", e),
  });

  const startEdit = (payee: Payee) => {
    setEditId(payee.id);
    setForm({
      name: payee.name,
      default_category_id: payee.default_category_id || undefined,
      transfer_account_id: payee.transfer_account_id || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payees"
        actions={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add Payee</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Payee</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Starbucks" />
              </div>
              <div className="space-y-2">
                <Label>Default Category</Label>
                <Select value={form.default_category_id || "none"} onValueChange={(v) => setForm({ ...form, default_category_id: v === "none" ? undefined : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Transfer Account</Label>
                <Select value={form.transfer_account_id || "none"} onValueChange={(v) => setForm({ ...form, transfer_account_id: v === "none" ? undefined : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {accounts.map((a: Account) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending || !form.name.trim()}>Add Payee</Button>
            </form>
          </DialogContent>
        </Dialog>
        }
      />

      <Dialog open={!!editId} onOpenChange={(open) => { if (!open) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Payee</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (editId) updateMutation.mutate({ id: editId, data: form }); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Default Category</Label>
              <Select value={form.default_category_id || "none"} onValueChange={(v) => setForm({ ...form, default_category_id: v === "none" ? undefined : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Transfer Account</Label>
              <Select value={form.transfer_account_id || "none"} onValueChange={(v) => setForm({ ...form, transfer_account_id: v === "none" ? undefined : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {accounts.map((a: Account) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={updateMutation.isPending}>Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Payee"
        description="This will permanently delete this payee."
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
      />

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search payees..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <QueryState
            isLoading={isLoading && !payees.length}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            isEmpty={!isLoading && payees.length === 0}
            emptyDescription="No payees yet. Add one to speed up transaction entry."
            loadingFallback={<SkeletonTable rows={6} columns={4} />}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Default Category</TableHead>
                  <TableHead>Transfer Account</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payees.map((payee: Payee) => (
                  <TableRow key={payee.id}>
                    <TableCell className="font-medium">{payee.name}</TableCell>
                    <TableCell>
                      {payee.default_category_id ? (
                        <Badge variant="secondary">{catNameMap[payee.default_category_id] || "—"}</Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {payee.transfer_account_id ? acctNameMap[payee.transfer_account_id] || "—" : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(payee)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteId(payee.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PayeesPage() {
  return <PayeesContent />;
}
