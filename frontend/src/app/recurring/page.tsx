"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recurringApi, type RecurringTransaction, type RecurringCreate } from "@/lib/api/recurring";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { payeesApi, type Payee } from "@/lib/api/payees";
import { formatCurrency } from "@/lib/format";
import { useFlatCategories, getApiErrorMessage, useIsClient } from "@/lib/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton-table";

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const EMPTY_FORM: RecurringCreate = {
  amount: 0,
  frequency: "monthly",
  next_date: new Date().toISOString().split("T")[0],
};

interface RecurringFormProps {
  form: RecurringCreate;
  setForm: (f: RecurringCreate) => void;
  payees: Payee[];
  accounts: Account[];
  allCategories: { id: string; name: string; groupName: string }[];
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  submitLabel: string;
}

function RecurringForm({ form, setForm, payees, accounts, allCategories, onSubmit, isPending, submitLabel }: RecurringFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Payee</Label>
        <Select value={form.payee_id || ""} onValueChange={(v) => setForm({ ...form, payee_id: v || undefined })}>
          <SelectTrigger><SelectValue placeholder="Select payee" /></SelectTrigger>
          <SelectContent>
            {payees.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Amount</Label>
          <Input
            type="number" step="0.01"
            value={form.amount || ""}
            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
            placeholder="-50.00"
          />
        </div>
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Next Date</Label>
          <Input type="date" value={form.next_date} onChange={(e) => setForm({ ...form, next_date: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Account</Label>
          <Select value={form.account_id || ""} onValueChange={(v) => setForm({ ...form, account_id: v || undefined })}>
            <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={form.category_id || ""} onValueChange={(v) => setForm({ ...form, category_id: v || undefined })}>
          <SelectTrigger><SelectValue placeholder="Uncategorized" /></SelectTrigger>
          <SelectContent>
            {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_subscription"
          checked={form.is_subscription || false}
          onChange={(e) => setForm({ ...form, is_subscription: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 accent-primary"
        />
        <Label htmlFor="is_subscription">Subscription</Label>
      </div>
      <Button type="submit" className="w-full" disabled={isPending}>{submitLabel}</Button>
    </form>
  );
}

function RecurringContent() {
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<RecurringTransaction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<RecurringCreate>({ ...EMPTY_FORM });
  const [editForm, setEditForm] = useState<RecurringCreate>({ ...EMPTY_FORM });

  const queryClient = useQueryClient();
  const isClient = useIsClient();

  const { data: items = [], isLoading, isError, error } = useQuery({
    queryKey: ["recurring"],
    queryFn: recurringApi.list,
    enabled: isClient,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { data: payees = [] } = useQuery({
    queryKey: ["payees"],
    queryFn: () => payeesApi.list(),
    enabled: isClient,
  });

  const { allCategories } = useFlatCategories();

  const createMutation = useMutation({
    mutationFn: recurringApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      toast.success("Recurring transaction created");
      setAddOpen(false);
      setAddForm({ ...EMPTY_FORM });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to create")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RecurringCreate> }) =>
      recurringApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      toast.success("Updated");
      setEditItem(null);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to update")),
  });

  const deleteMutation = useMutation({
    mutationFn: recurringApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      toast.success("Deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to delete")),
  });

  const openEdit = (item: RecurringTransaction) => {
    setEditItem(item);
    setEditForm({
      payee_id: item.payee_id ?? undefined,
      amount: item.amount,
      category_id: item.category_id ?? undefined,
      frequency: item.frequency,
      next_date: item.next_date,
      account_id: item.account_id ?? undefined,
      is_subscription: item.is_subscription,
    });
  };

  const sharedProps = { payees, accounts: accounts as Account[], allCategories };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Recurring Transactions</h1>
        <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setAddForm({ ...EMPTY_FORM }); }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Recurring Transaction</DialogTitle></DialogHeader>
            <RecurringForm
              {...sharedProps}
              form={addForm}
              setForm={setAddForm}
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(addForm); }}
              isPending={createMutation.isPending}
              submitLabel="Add Recurring"
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Recurring Transaction</DialogTitle></DialogHeader>
          <RecurringForm
            {...sharedProps}
            form={editForm}
            setForm={setEditForm}
            onSubmit={(e) => { e.preventDefault(); if (editItem) updateMutation.mutate({ id: editItem.id, data: editForm }); }}
            isPending={updateMutation.isPending}
            submitLabel="Save Changes"
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Recurring Transaction"
        description="This will permanently delete this recurring transaction."
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
      />

      <Card>
        <CardContent className="pt-6">
          {isError ? (
            <p className="text-destructive py-4">{getApiErrorMessage(error, "Failed to load recurring transactions")}</p>
          ) : isLoading ? (
            <SkeletonTable rows={4} columns={6} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payee</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: RecurringTransaction) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.payee_name || "—"}
                      {item.is_subscription && <Badge variant="outline" className="ml-2 text-xs">Sub</Badge>}
                    </TableCell>
                    <TableCell className="capitalize">{item.frequency}</TableCell>
                    <TableCell>{new Date(item.next_date).toLocaleDateString()}</TableCell>
                    <TableCell>{item.category_name ? <Badge variant="secondary">{item.category_name}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.account_name || "—"}</TableCell>
                    <TableCell className={`text-right font-mono ${Number(item.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(Number(item.amount))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No recurring transactions yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RecurringPage() {
  return <AuthGuard><RecurringContent /></AuthGuard>;
}
