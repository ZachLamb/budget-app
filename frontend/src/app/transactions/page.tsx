"use client";

import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  transactionsApi,
  type Transaction,
  type TransactionCreate,
  type TransactionFilters,
  type TransactionList,
} from "@/lib/api/transactions";
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
import { Plus, Upload, Search, ChevronLeft, ChevronRight, Trash2, Pencil, Download, ArrowLeftRight, SplitSquareHorizontal, CheckCircle, Circle, FileText, MoreHorizontal, Stethoscope, ChevronDown, ChevronUp, Loader2, ArrowUpDown, Check, X, Undo2, MessageSquare } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { appToast } from "@/lib/app-toast";
import api from "@/lib/api/client";
import { aiApi } from "@/lib/api/ai";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useFlatCategories, getApiErrorMessage, useIsClient } from "@/lib/hooks";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton-table";
import Link from "next/link";

type TransactionSplitLinePayload = {
  amount: number;
  category_id: string | null;
  notes: string | null;
};

const FSA_CONF_ORDER = { high: 3, medium: 2, low: 1 } as const;

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
  const [importGateOpen, setImportGateOpen] = useState(false);
  const [importPickAccountId, setImportPickAccountId] = useState("");
  const [fsaOpen, setFsaOpen] = useState(false);
  const [fsaDateFrom, setFsaDateFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [fsaDateTo, setFsaDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [fsaConfFilter, setFsaConfFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [fsaSortCol, setFsaSortCol] = useState<"date" | "amount" | "confidence">("date");
  const [fsaSortDir, setFsaSortDir] = useState<"asc" | "desc">("desc");
  const [fsaShowDismissed, setFsaShowDismissed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const searchParams = useSearchParams();

  useEffect(() => {
    const raw = searchParams.get("uncategorized");
    if (raw !== "1" && raw !== "true") return;
    queueMicrotask(() => {
      setFilters((f) => ({ ...f, uncategorized: true, page: 1 }));
    });
  }, [searchParams]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { allCategories } = useFlatCategories();
  const { data: fsaData, isLoading: fsaLoading, isFetching: fsaFetching, isError: fsaError, refetch: fsaRefetch } = useQuery({
    queryKey: ["fsa-review", fsaDateFrom, fsaDateTo],
    queryFn: () => aiApi.getFsaReview({ date_from: fsaDateFrom, date_to: fsaDateTo }),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  const filteredFsa = useMemo(() => {
    if (!fsaData?.eligible_transactions) return [];
    let items = fsaData.eligible_transactions;
    if (!fsaShowDismissed) items = items.filter((t) => t.status !== "dismissed");
    if (fsaConfFilter !== "all") items = items.filter((t) => t.confidence === fsaConfFilter);
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (fsaSortCol === "date") cmp = a.date.localeCompare(b.date);
      else if (fsaSortCol === "amount") cmp = a.amount - b.amount;
      else cmp = FSA_CONF_ORDER[a.confidence] - FSA_CONF_ORDER[b.confidence];
      return fsaSortDir === "asc" ? cmp : -cmp;
    });
  }, [fsaData, fsaConfFilter, fsaSortCol, fsaSortDir, fsaShowDismissed]);

  const handleFsaExportCsv = () => {
    if (!filteredFsa.length) return;
    const header = "Date,Payee,Amount,FSA Category,Confidence,Reason";
    const rows = filteredFsa.map((t) =>
      [t.date, `"${t.payee_name.replace(/"/g, '""')}"`, t.amount.toFixed(2), `"${t.fsa_category}"`, t.confidence, `"${t.reason.replace(/"/g, '""')}"`].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fsa-review-${fsaDateFrom}-to-${fsaDateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFsaSort = (col: "date" | "amount" | "confidence") => {
    if (fsaSortCol === col) setFsaSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setFsaSortCol(col); setFsaSortDir("desc"); }
  };

  const fsaStatusMutation = useMutation({
    mutationFn: ({ txnId, status }: { txnId: string; status: "pending" | "claimed" | "dismissed" }) =>
      aiApi.updateFsaItemStatus(txnId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fsa-review"] }),
  });

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
      appToast.success("Transaction added");
      setAddOpen(false);
    },
    onError: (e) => toastApiError("Failed to add transaction", e),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TransactionCreate> }) => transactionsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      appToast.success("Transaction updated");
      setEditTxn(null);
    },
    onError: (e) => toastApiError("Failed to update transaction", e),
  });

  const deleteMutation = useMutation({
    mutationFn: transactionsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      appToast.success("Transaction deleted");
    },
    onError: (e) => toastApiError("Failed to delete transaction", e),
  });

  const transferMutation = useMutation({
    mutationFn: (data: typeof transferForm) =>
      api.post("/transactions/transfer", data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      appToast.success("Transfer created");
      setTransferOpen(false);
    },
    onError: (e) => toastApiError("Transfer failed", e),
  });

  const splitMutation = useMutation({
    mutationFn: ({ id, splits }: { id: string; splits: TransactionSplitLinePayload[] }) =>
      api.post(`/transactions/${id}/split`, { splits }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      appToast.success("Transaction split");
      setSplitTxn(null);
    },
    onError: (e: unknown) => toastApiError("Split failed", e),
  });

  const toggleCleared = useMutation({
    mutationFn: ({ id, cleared }: { id: string; cleared: boolean }) =>
      transactionsApi.update(id, { cleared }),
    onMutate: async ({ id, cleared }) => {
      await queryClient.cancelQueries({ queryKey: ["transactions", filters] });
      const previous = queryClient.getQueryData(["transactions", filters]);
      queryClient.setQueryData(["transactions", filters], (old: TransactionList | undefined) => {
        if (!old) return old;
        return {
          ...old,
          transactions: old.transactions.map((t) =>
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

  const openImportFlow = () => {
    if (accounts.length === 0) {
      toastPlainError("Add an account before importing a CSV.");
      return;
    }
    if (!filters.account_id) {
      setImportPickAccountId(accounts[0]?.id ?? "");
      setImportGateOpen(true);
      return;
    }
    fileRef.current?.click();
  };

  const confirmImportAccountAndPickFile = () => {
    if (!importPickAccountId) {
      toastPlainError("Choose an account to import into.");
      return;
    }
    setFilters((f) => ({ ...f, account_id: importPickAccountId, page: 1 }));
    setImportGateOpen(false);
    requestAnimationFrame(() => fileRef.current?.click());
  };

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !filters.account_id) {
      toastPlainError("Select an account first");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", filters.account_id);
    try {
      const res = await api.post("/upload/csv", formData, { headers: { "Content-Type": "multipart/form-data" } });
      appToast.success(`Imported ${res.data.imported} transactions (${res.data.skipped} skipped)`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toastApiError("CSV import failed", e);
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
    } catch (e) {
      toastApiError("Export failed", e);
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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Search, import, split, and categorize activity across your accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
            <Link
              href={`/?ai_open=1&ai_prompt=${encodeURIComponent(
                "Help me categorize uncategorized transactions and suggest rules for similar payees.",
              )}`}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Ask AI
            </Link>
          </Button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          <Button variant="outline" size="sm" onClick={handleExport} className="hidden md:inline-flex">
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={openImportFlow} className="hidden md:inline-flex">
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)} className="hidden md:inline-flex">
            <ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="md:hidden">
                <MoreHorizontal className="mr-2 h-4 w-4" /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" /> Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openImportFlow}>
                <Upload className="mr-2 h-4 w-4" /> Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!form.account_id) { toastPlainError("Please select an account"); return; }
                if (!form.amount) { toastPlainError("Please enter an amount"); return; }
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

      <Dialog open={importGateOpen} onOpenChange={setImportGateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import CSV</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Choose which account these transactions belong to. The list below will filter to that account after you continue.
          </p>
          <div className="space-y-2">
            <Label htmlFor="import-account">Account</Label>
            <Select value={importPickAccountId} onValueChange={setImportPickAccountId}>
              <SelectTrigger id="import-account">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a: Account) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setImportGateOpen(false)}>Cancel</Button>
            <Button onClick={confirmImportAccountAndPickFile}>Choose file</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTxn} onOpenChange={(open) => { if (!open) setEditTxn(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
          <form onSubmit={(e) => {
                e.preventDefault();
                if (!editForm.account_id) { toastPlainError("Please select an account"); return; }
                if (!editForm.amount) { toastPlainError("Please enter an amount"); return; }
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
                if (!transferForm.from_account_id || !transferForm.to_account_id) { toastPlainError("Please select both accounts"); return; }
                if (transferForm.from_account_id === transferForm.to_account_id) { toastPlainError("Accounts must be different"); return; }
                if (!transferForm.amount || transferForm.amount <= 0) { toastPlainError("Amount must be positive"); return; }
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

      {/* FSA Reimbursement Review */}
      <Card>
        <CardHeader>
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setFsaOpen(!fsaOpen)}
          >
            <div className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-purple-500" />
              <span className="font-semibold">FSA Reimbursement Review</span>
            </div>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", fsaOpen && "rotate-180")} />
          </button>
        </CardHeader>
        {fsaOpen && (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan your transactions to find purchases that may be eligible for FSA reimbursement.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" className="w-40" value={fsaDateFrom} onChange={(e) => setFsaDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" className="w-40" value={fsaDateTo} onChange={(e) => setFsaDateTo(e.target.value)} />
              </div>
              <Button
                size="sm"
                onClick={() => fsaRefetch()}
                disabled={fsaFetching}
              >
                {fsaFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Stethoscope className="mr-2 h-4 w-4" />}
                Scan Transactions
              </Button>
            </div>

            {fsaError && (
              <p className="text-sm text-destructive">Failed to scan transactions. Check that AI is enabled in Settings.</p>
            )}

            {fsaData && !fsaFetching && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
                  <p className="text-sm">
                    {fsaConfFilter !== "all" ? (
                      <>Showing <span className="font-semibold">{filteredFsa.length}</span> of{" "}</>
                    ) : null}
                    <span className="font-semibold">{fsaData.eligible_transactions.length}</span> potentially eligible
                    {fsaData.eligible_transactions.length === 1 ? " transaction" : " transactions"} totaling{" "}
                    <span className="font-semibold font-mono">{formatCurrency(fsaData.total_potential_amount)}</span>
                    {" "}across {fsaData.scan_count} scanned.
                    {fsaData.parse_errors > 0 && (
                      <span className="text-yellow-600 ml-2">({fsaData.parse_errors} batch{fsaData.parse_errors > 1 ? "es" : ""} failed to parse)</span>
                    )}
                  </p>
                  {fsaData.eligible_transactions.length > 0 && (
                    <Button size="sm" variant="outline" onClick={handleFsaExportCsv}>
                      <Download className="mr-2 h-4 w-4" />Export CSV
                    </Button>
                  )}
                </div>

                {fsaData.eligible_transactions.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <Label className="text-xs whitespace-nowrap">Confidence:</Label>
                      <Select value={fsaConfFilter} onValueChange={(v) => setFsaConfFilter(v as typeof fsaConfFilter)}>
                        <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-auto">
                        <input type="checkbox" checked={fsaShowDismissed} onChange={(e) => setFsaShowDismissed(e.target.checked)} className="rounded" />
                        Show dismissed
                      </label>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="cursor-pointer select-none" onClick={() => toggleFsaSort("date")}>
                            <span className="inline-flex items-center gap-1">Date {fsaSortCol === "date" ? (fsaSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}</span>
                          </TableHead>
                          <TableHead>Payee</TableHead>
                          <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleFsaSort("amount")}>
                            <span className="inline-flex items-center gap-1 justify-end">Amount {fsaSortCol === "amount" ? (fsaSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}</span>
                          </TableHead>
                          <TableHead>FSA Category</TableHead>
                          <TableHead className="cursor-pointer select-none" onClick={() => toggleFsaSort("confidence")}>
                            <span className="inline-flex items-center gap-1">Confidence {fsaSortCol === "confidence" ? (fsaSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}</span>
                          </TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredFsa.map((t) => (
                          <TableRow key={t.transaction_id} className={cn(t.status === "dismissed" && "opacity-50")}>
                            <TableCell className="text-sm">{new Date(t.date).toLocaleDateString()}</TableCell>
                            <TableCell className="font-medium">{t.payee_name}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(t.amount)}</TableCell>
                            <TableCell><Badge variant="outline">{t.fsa_category}</Badge></TableCell>
                            <TableCell>
                              <Badge className={cn(
                                t.confidence === "high" && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                                t.confidence === "medium" && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                                t.confidence === "low" && "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
                              )}>
                                {t.confidence}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-xs">{t.reason}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {t.status === "claimed" ? (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
                                    <Check className="h-3 w-3" />Claimed
                                  </Badge>
                                ) : t.status === "dismissed" ? (
                                  <button
                                    title="Undo dismiss"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => fsaStatusMutation.mutate({ txnId: t.transaction_id, status: "pending" })}
                                  >
                                    <Undo2 className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      title="Mark as claimed"
                                      className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                                      onClick={() => fsaStatusMutation.mutate({ txnId: t.transaction_id, status: "claimed" })}
                                    >
                                      <Check className="h-4 w-4" />
                                    </button>
                                    <button
                                      title="Dismiss"
                                      className="text-muted-foreground hover:text-destructive"
                                      onClick={() => fsaStatusMutation.mutate({ txnId: t.transaction_id, status: "dismissed" })}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  These are estimates based on payee names. Verify eligibility with your FSA plan administrator before submitting claims.
                </p>
              </>
            )}
          </CardContent>
        )}
      </Card>

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
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <TransactionsContent />
      </Suspense>
    </AuthGuard>
  );
}
