"use client";

import { useState, useRef, useMemo, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  transactionsApi,
  type Transaction,
  type TransactionCreate,
  type TransactionList,
} from "@/lib/api/transactions";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { reportsApi, type LlmSuggestion } from "@/lib/api/reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Trash2, Download, ArrowLeftRight, MoreHorizontal, MessageSquare, Sparkles } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { appToast } from "@/lib/app-toast";
import api from "@/lib/api/client";
import { aiApi } from "@/lib/api/ai";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useFlatCategories, useIsClient, useDemoGuard } from "@/lib/hooks";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import Link from "next/link";
import { ExplainCharge } from "@/components/llm/explain-charge";
import { PageHeader, inlineErrorQueryMeta } from "@/components/page";
import { CategoryReviewDialog } from "@/components/transactions/category-review-dialog";
import { TransactionFiltersBar } from "@/components/transactions/transaction-filters-bar";
import { TransactionListSection } from "@/components/transactions/transaction-list-section";
import { FsaReviewPanel } from "@/components/transactions/fsa-review-panel";
import { useTransactionFilters } from "@/components/transactions/use-transaction-filters";
import { clampPage } from "@/lib/transaction-filters-url";

type TransactionSplitLinePayload = {
  amount: number;
  category_id: string | null;
  notes: string | null;
};

const FSA_CONF_ORDER = { high: 3, medium: 2, low: 1 } as const;

function TransactionsContent() {
  const { isDemo } = useDemoGuard();
  const [addOpen, setAddOpen] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [detailTxn, setDetailTxn] = useState<Transaction | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [splitItems, setSplitItems] = useState<{ amount: number; category_id: string; notes: string }[]>([]);
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
  const [fsaIncludeAllOutflows, setFsaIncludeAllOutflows] = useState(false);
  const [categoryReviewOpen, setCategoryReviewOpen] = useState(false);
  const [llmCategorySuggestions, setLlmCategorySuggestions] = useState<LlmSuggestion[]>([]);
  const [categoryReviewOverrides, setCategoryReviewOverrides] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const { filters, setFilters, updateFilters } = useTransactionFilters();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { allCategories } = useFlatCategories();
  const { data: fsaData, isLoading: fsaLoading, isFetching: fsaFetching, isError: fsaError, refetch: fsaRefetch } = useQuery({
    queryKey: ["fsa-review", fsaDateFrom, fsaDateTo, fsaIncludeAllOutflows],
    queryFn: () =>
      aiApi.getFsaReview({
        date_from: fsaDateFrom,
        date_to: fsaDateTo,
        include_all_outflows: fsaIncludeAllOutflows,
      }),
    enabled: isClient && fsaOpen,
    staleTime: 60 * 1000,
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
    onError: (e) => toastApiError("Could not update FSA status", e),
  });

  const suggestCategoriesMutation = useMutation({
    mutationFn: () =>
      reportsApi.suggestCategories({
        account_id: filters.account_id,
        date_from: filters.date_from,
        date_to: filters.date_to,
        search: filters.search?.trim() || undefined,
        limit: 50,
      }),
    onSuccess: (data) => {
      setCategoryReviewOverrides({});
      setLlmCategorySuggestions(data.suggestions);
      setCategoryReviewOpen(true);
      if (data.suggestions.length === 0) {
        appToast.info("No uncategorized transactions to suggest for.");
      }
    },
    onError: (e) => toastApiError("Failed to get AI category suggestions", e),
  });

  const applyCategorySuggestionsMutation = useMutation({
    mutationFn: reportsApi.applySuggestions,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setLlmCategorySuggestions([]);
      setCategoryReviewOverrides({});
      setCategoryReviewOpen(false);
      appToast.success(`Applied ${data.applied} suggestion${data.applied === 1 ? "" : "s"}.`);
    },
    onError: (e) => toastApiError("Failed to apply categories", e),
  });

  const applyOneCategorySuggestionMutation = useMutation({
    mutationFn: (payload: { transaction_id: string; category_id: string }) =>
      reportsApi.applySuggestions([payload]),
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setLlmCategorySuggestions((prev) => prev.filter((s) => s.transaction_id !== vars.transaction_id));
      setCategoryReviewOverrides((o) => {
        const next = { ...o };
        delete next[vars.transaction_id];
        return next;
      });
      appToast.success(data.applied > 0 ? "Category applied." : "Nothing to apply.");
    },
    onError: (e) => toastApiError("Failed to apply category", e),
  });

  const { data: txnData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => transactionsApi.list(filters),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
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

  const inlineCategoryMutation = useMutation({
    mutationFn: ({ id, category_id }: { id: string; category_id: string | null }) =>
      transactionsApi.update(id, { category_id }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setLlmCategorySuggestions((prev) => prev.filter((s) => s.transaction_id !== vars.id));
    },
    onError: (e) => toastApiError("Could not update category", e),
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
    // Seed an even 2-way split: both lines get half of the transaction
    // amount so the user only has to adjust one side. This is closer to
    // the typical "split a joint charge" intent than "100% on line 1,
    // $0 on line 2" was.
    const total = Number(txn.amount);
    const half = Math.round((total / 2) * 100) / 100;
    setSplitItems([
      { amount: half, category_id: "", notes: "" },
      // Put the rounding remainder on the second line so sums exactly match.
      { amount: Math.round((total - half) * 100) / 100, category_id: "", notes: "" },
    ]);
  };

  const totalPages = txnData ? Math.max(1, Math.ceil(txnData.total / txnData.page_size)) : 1;

  const categorySuggestionByTxnId = useMemo(() => {
    const m = new Map<string, LlmSuggestion>();
    for (const s of llmCategorySuggestions) {
      m.set(s.transaction_id, s);
    }
    return m;
  }, [llmCategorySuggestions]);

  const getReviewCategoryId = (s: LlmSuggestion) =>
    categoryReviewOverrides[s.transaction_id] ?? s.suggested_category_id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Search, import, split, and categorize activity across your accounts."
        actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex"
            disabled={suggestCategoriesMutation.isPending}
            onClick={() => suggestCategoriesMutation.mutate()}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {suggestCategoriesMutation.isPending ? "Suggesting…" : "Suggest categories"}
          </Button>
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
              <DropdownMenuItem
                disabled={suggestCategoriesMutation.isPending}
                onClick={() => suggestCategoriesMutation.mutate()}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {suggestCategoriesMutation.isPending ? "Suggesting…" : "Suggest categories"}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={`/?ai_open=1&ai_prompt=${encodeURIComponent(
                    "Help me categorize uncategorized transactions and suggest rules for similar payees.",
                  )}`}
                >
                  <MessageSquare className="mr-2 h-4 w-4" /> Ask AI
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
        }
      />

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
              <div key={i} className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
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
                {!item.category_id && item.amount !== 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    This split will save as uncategorized. Pick a category or it will be hidden from budget reports.
                  </p>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Default the new line's amount to whatever is still
                // unaccounted for, so the common "split A + B + C where the
                // remainder goes to the last line" flow doesn't require any
                // math from the user.
                const remaining =
                  Number(splitTxn?.amount || 0) - splitItems.reduce((s, x) => s + x.amount, 0);
                const seeded = Math.round(remaining * 100) / 100;
                setSplitItems([
                  ...splitItems,
                  { amount: seeded, category_id: "", notes: "" },
                ]);
              }}
            >
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
              <div className="border-t pt-3">
                <ExplainCharge txn={detailTxn} />
              </div>
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

      <CategoryReviewDialog
        open={categoryReviewOpen}
        onOpenChange={setCategoryReviewOpen}
        suggestions={llmCategorySuggestions}
        onSuggestionsChange={setLlmCategorySuggestions}
        categoryOverrides={categoryReviewOverrides}
        onCategoryOverridesChange={setCategoryReviewOverrides}
        allCategories={allCategories}
        isDemo={isDemo}
        getReviewCategoryId={getReviewCategoryId}
        applyOneMutation={applyOneCategorySuggestionMutation}
        applyAllMutation={applyCategorySuggestionsMutation}
      />

      <FsaReviewPanel
        fsaOpen={fsaOpen}
        setFsaOpen={setFsaOpen}
        fsaDateFrom={fsaDateFrom}
        setFsaDateFrom={setFsaDateFrom}
        fsaDateTo={fsaDateTo}
        setFsaDateTo={setFsaDateTo}
        fsaIncludeAllOutflows={fsaIncludeAllOutflows}
        setFsaIncludeAllOutflows={setFsaIncludeAllOutflows}
        fsaConfFilter={fsaConfFilter}
        setFsaConfFilter={setFsaConfFilter}
        fsaShowDismissed={fsaShowDismissed}
        setFsaShowDismissed={setFsaShowDismissed}
        fsaSortCol={fsaSortCol}
        fsaSortDir={fsaSortDir}
        toggleFsaSort={toggleFsaSort}
        fsaData={fsaData}
        fsaLoading={fsaLoading}
        fsaFetching={fsaFetching}
        fsaError={fsaError}
        fsaRefetch={fsaRefetch}
        filteredFsa={filteredFsa}
        handleFsaExportCsv={handleFsaExportCsv}
        fsaStatusMutation={fsaStatusMutation}
        isDemo={isDemo}
      />
      <TransactionFiltersBar
        filters={filters}
        accounts={accounts}
        allCategories={allCategories}
        onFiltersChange={updateFilters}
      />
      <TransactionListSection
        filters={filters}
        txnData={txnData}
        isLoading={isLoading}
        isError={isError}
        error={error}
        refetch={refetch}
        accounts={accounts}
        allCategories={allCategories}
        toggleCleared={toggleCleared}
        inlineCategoryMutation={inlineCategoryMutation}
        categorySuggestionByTxnId={categorySuggestionByTxnId}
        isDemo={isDemo}
        totalPages={totalPages}
        updateFilters={updateFilters}
        clampPage={clampPage}
        setDetailTxn={setDetailTxn}
        startEdit={startEdit}
        startSplit={startSplit}
        setDeleteId={setDeleteId}
      />
    </div>
  );
}

export default function TransactionsPage() {
  return (
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <TransactionsContent />
      </Suspense>
  );
}
