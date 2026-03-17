"use client";

import { useState, useRef } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionsApi, type Transaction, type TransactionCreate, type TransactionFilters } from "@/lib/api/transactions";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { reportsApi } from "@/lib/api/reports";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Search, ChevronLeft, ChevronRight, Trash2, Pencil, Download, ArrowLeftRight, SplitSquareHorizontal, CheckCircle, Circle, FileText, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import api from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useFlatCategories, getApiErrorMessage, useIsClient } from "@/lib/hooks";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton-table";

function TransactionsContent() {
  const [addOpen, setAddOpen] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [detailTxn, setDetailTxn] = useState<Transaction | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [splitItems, setSplitItems] = useState<{ amount: number; category_id: string; notes: string }[]>([]);
  const [filters, setFilters] = useState<TransactionFilters>({ page: 1, page_size: 50 });
  const [form, setForm] = useState<TransactionCreate>({ account_id: "", date: new Date().toISOString().split("T")[0], amount: 0, payee_name: "" });
  const [editForm, setEditForm] = useState<Partial<TransactionCreate & { cleared: boolean; reconciled: boolean; notes: string }>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState({ from_account_id: "", to_account_id: "", amount: 0, date: new Date().toISOString().split("T")[0], notes: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { allCategories } = useFlatCategories();
  const { data: txnData, isLoading, isError, error } = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => transactionsApi.list(filters),
    enabled: isClient,
  });

  const createMutation = useMutation({
    mutationFn: transactionsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transaction added");
      setAddOpen(false);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to add transaction")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TransactionCreate> }) => transactionsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transaction updated");
      setEditTxn(null);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to update transaction")),
  });

  const deleteMutation = useMutation({
    mutationFn: transactionsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transaction deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to delete transaction")),
  });

  const transferMutation = useMutation({
    mutationFn: (data: typeof transferForm) =>
      api.post("/transactions/transfer", data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transfer created");
      setTransferOpen(false);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Transfer failed")),
  });

  const splitMutation = useMutation({
    mutationFn: ({ id, splits }: { id: string; splits: typeof splitItems }) =>
      api.post(`/transactions/${id}/split`, { splits }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transaction split");
      setSplitTxn(null);
    },
    onError: (e: unknown) => toast.error(getApiErrorMessage(e, "Split failed")),
  });

  const toggleCleared = useMutation({
    mutationFn: ({ id, cleared }: { id: string; cleared: boolean }) =>
      transactionsApi.update(id, { cleared }),
    onMutate: async ({ id, cleared }) => {
      await queryClient.cancelQueries({ queryKey: ["transactions", filters] });
      const previous = queryClient.getQueryData(["transactions", filters]);
      queryClient.setQueryData(["transactions", filters], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          transactions: old.transactions.map((t: any) =>
            t.id === id ? { ...t, cleared } : t
          ),
        };
      });
      return { previous };
    },
    onError: (_e, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["transactions", filters], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !filters.account_id) {
      toast.error("Select an account first");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", filters.account_id);
    try {
      const res = await api.post("/upload/csv", formData, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported ${res.data.imported} transactions (${res.data.skipped} skipped)`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch {
      toast.error("CSV import failed");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleExport = async () => {
    try {
      const blob = await reportsApi.exportCsv({
        account_id: filters.account_id,
        date_from: filters.date_from,
        date_to: filters.date_to,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "transactions.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  const startEdit = (txn: Transaction) => {
    setEditTxn(txn);
    setEditForm({
      account_id: txn.account_id,
      date: txn.date,
      amount: Number(txn.amount),
      category_id: txn.category_id || undefined,
      notes: txn.notes || "",
      cleared: txn.cleared,
      reconciled: txn.reconciled,
    });
  };

  const startSplit = (txn: Transaction) => {
    setSplitTxn(txn);
    setSplitItems([
      { amount: Number(txn.amount), category_id: "", notes: "" },
      { amount: 0, category_id: "", notes: "" },
    ]);
  };

  const totalPages = txnData ? Math.ceil(txnData.total / txnData.page_size) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!form.account_id) { toast.error("Please select an account"); return; }
                if (!form.amount) { toast.error("Please enter an amount"); return; }
                createMutation.mutate(form);
              }} className="space-y-4">
                <div className="space-y-2">
                  <Label>Account</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: Account) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input type="number" step="0.01" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} placeholder="-50.00" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Payee</Label>
                  <Input value={form.payee_name || ""} onChange={(e) => setForm({ ...form, payee_name: e.target.value })} placeholder="e.g. Starbucks" />
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
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>Add Transaction</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTxn} onOpenChange={(open) => { if (!open) setEditTxn(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
          <form onSubmit={(e) => {
                e.preventDefault();
                if (!editForm.account_id) { toast.error("Please select an account"); return; }
                if (!editForm.amount) { toast.error("Please enter an amount"); return; }
                if (editTxn) updateMutation.mutate({ id: editTxn.id, data: editForm });
              }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={editForm.date || ""} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={editForm.amount || ""} onChange={(e) => setEditForm({ ...editForm, amount: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={editForm.category_id || "uncategorized"} onValueChange={(v) => setEditForm({ ...editForm, category_id: v === "uncategorized" ? undefined : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="uncategorized">Uncategorized</SelectItem>
                  {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={editForm.notes || ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-cleared" checked={editForm.cleared || false} onChange={(e) => setEditForm({ ...editForm, cleared: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                <Label htmlFor="edit-cleared">Cleared</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-reconciled" checked={editForm.reconciled || false} onChange={(e) => setEditForm({ ...editForm, reconciled: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                <Label htmlFor="edit-reconciled">Reconciled</Label>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={updateMutation.isPending}>Save Changes</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Between Accounts</DialogTitle></DialogHeader>
          <form onSubmit={(e) => {
                e.preventDefault();
                if (!transferForm.from_account_id || !transferForm.to_account_id) { toast.error("Please select both accounts"); return; }
                if (transferForm.from_account_id === transferForm.to_account_id) { toast.error("Accounts must be different"); return; }
                if (!transferForm.amount || transferForm.amount <= 0) { toast.error("Amount must be positive"); return; }
                transferMutation.mutate(transferForm);
              }} className="space-y-4">
            <div className="space-y-2">
              <Label>From Account</Label>
              <Select value={transferForm.from_account_id} onValueChange={(v) => setTransferForm({ ...transferForm, from_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: Account) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To Account</Label>
              <Select value={transferForm.to_account_id} onValueChange={(v) => setTransferForm({ ...transferForm, to_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((a: Account) => a.id !== transferForm.from_account_id).map((a: Account) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={transferForm.amount || ""} onChange={(e) => setTransferForm({ ...transferForm, amount: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} placeholder="Optional" />
            </div>
            <Button type="submit" className="w-full" disabled={transferMutation.isPending}>Create Transfer</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Split Dialog */}
      <Dialog open={!!splitTxn} onOpenChange={(open) => { if (!open) setSplitTxn(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Split Transaction ({splitTxn && formatCurrency(Number(splitTxn.amount))})</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {splitItems.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.amount || ""}
                    onChange={(e) => {
                      const next = [...splitItems];
                      next[i] = { ...next[i], amount: parseFloat(e.target.value) || 0 };
                      setSplitItems(next);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={item.category_id || "none"} onValueChange={(v) => {
                    const next = [...splitItems];
                    next[i] = { ...next[i], category_id: v === "none" ? "" : v };
                    setSplitItems(next);
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Uncategorized</SelectItem>
                      {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {splitItems.length > 2 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSplitItems(splitItems.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSplitItems([...splitItems, { amount: 0, category_id: "", notes: "" }])}>
              <Plus className="mr-2 h-3 w-3" /> Add Split
            </Button>
            {(() => {
              const remaining = Number(splitTxn?.amount || 0) - splitItems.reduce((s, i) => s + i.amount, 0);
              return Math.abs(remaining) > 0.01 ? (
                <p className="text-sm text-destructive">Remaining: {formatCurrency(remaining)}</p>
              ) : null;
            })()}
            <Button
              className="w-full"
              disabled={splitMutation.isPending || Math.abs(Number(splitTxn?.amount || 0) - splitItems.reduce((s, i) => s + i.amount, 0)) > 0.01}
              onClick={() => {
                if (splitTxn) {
                  splitMutation.mutate({
                    id: splitTxn.id,
                    splits: splitItems.map((s) => ({
                      amount: s.amount,
                      category_id: s.category_id || null,
                      notes: s.notes || null,
                    })),
                  });
                }
              }}
            >
              Split Transaction
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailTxn} onOpenChange={(open) => { if (!open) setDetailTxn(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transaction Details</DialogTitle></DialogHeader>
          {detailTxn && (
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{new Date(detailTxn.date).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Payee</span><span className="font-medium">{detailTxn.payee_name || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className={cn("font-mono font-medium", Number(detailTxn.amount) >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Number(detailTxn.amount))}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span>{detailTxn.category_name || "Uncategorized"}</span></div>
              {detailTxn.notes && <div className="flex justify-between"><span className="text-muted-foreground">Notes</span><span className="text-sm text-right max-w-xs">{detailTxn.notes}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
                <div className="flex gap-2">
                  {detailTxn.cleared && <Badge className="bg-green-100 text-green-800">Cleared</Badge>}
                  {detailTxn.reconciled && <Badge className="bg-blue-100 text-blue-800">Reconciled</Badge>}
                  {!detailTxn.cleared && !detailTxn.reconciled && <Badge variant="secondary">Pending</Badge>}
                </div>
              </div>
              {detailTxn.is_split && <Badge variant="outline">Split Transaction</Badge>}
              {detailTxn.transfer_pair_id && <Badge variant="outline">Transfer</Badge>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Transaction"
        description="This will permanently delete this transaction."
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search transactions..."
                value={filters.search || ""}
                onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
              />
            </div>
            <Select value={filters.account_id || "all"} onValueChange={(v) => setFilters({ ...filters, account_id: v === "all" ? undefined : v, page: 1 })}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All accounts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((a: Account) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.category_id || "all"} onValueChange={(v) => setFilters({ ...filters, category_id: v === "all" ? undefined : v, uncategorized: false, page: 1 })}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input type="date" className="w-36" value={filters.date_from || ""} onChange={(e) => setFilters({ ...filters, date_from: e.target.value || undefined, page: 1 })} placeholder="From" />
              <Input type="date" className="w-36" value={filters.date_to || ""} onChange={(e) => setFilters({ ...filters, date_to: e.target.value || undefined, page: 1 })} placeholder="To" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="text-destructive py-4">{getApiErrorMessage(error, "Failed to load transactions")}</p>
          ) : isLoading ? (
            <SkeletonTable rows={8} columns={6} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Date</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txnData?.transactions.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell>
                        <button onClick={() => toggleCleared.mutate({ id: txn.id, cleared: !txn.cleared })} title={txn.cleared ? "Cleared" : "Uncleared"}>
                          {txn.cleared ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">{new Date(txn.date).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <button onClick={() => setDetailTxn(txn)} className="font-medium hover:underline text-left">
                          {txn.payee_name || "—"}
                          {txn.transfer_pair_id && <Badge variant="outline" className="ml-1 text-xs">Transfer</Badge>}
                          {txn.is_split && <Badge variant="outline" className="ml-1 text-xs">Split</Badge>}
                        </button>
                      </TableCell>
                      <TableCell>{txn.category_name ? <Badge variant="secondary">{txn.category_name}</Badge> : <span className="text-xs text-muted-foreground">Uncategorized</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-32 truncate">{txn.notes || ""}</TableCell>
                      <TableCell className={cn("text-right font-mono", Number(txn.amount) >= 0 ? "text-green-600" : "text-red-600")}>{formatCurrency(Number(txn.amount))}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startEdit(txn)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            {!txn.is_split && !txn.transfer_pair_id && (
                              <DropdownMenuItem onClick={() => startSplit(txn)}>
                                <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2" /> Split
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteId(txn.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!txnData?.transactions.length && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transactions found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {txnData && txnData.total > txnData.page_size && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Showing {txnData.transactions.length} of {txnData.total}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={filters.page === 1} onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="flex items-center text-sm">Page {filters.page} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={(filters.page || 1) >= totalPages} onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TransactionsPage() {
  return <AuthGuard><TransactionsContent /></AuthGuard>;
}
