"use client";

import { useState, useRef } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionsApi, type TransactionCreate, type TransactionFilters } from "@/lib/api/transactions";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Search, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api/client";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function TransactionsContent() {
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState<TransactionFilters>({ page: 1, page_size: 50 });
  const [form, setForm] = useState<TransactionCreate>({ account_id: "", date: new Date().toISOString().split("T")[0], amount: 0, payee_name: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: accountsApi.list });
  const { data: groups = [] } = useQuery({ queryKey: ["categoryGroups"], queryFn: categoriesApi.listGroups });
  const { data: txnData, isLoading } = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => transactionsApi.list(filters),
  });

  const allCategories = groups.flatMap((g: CategoryGroup) => g.categories.map((c) => ({ ...c, groupName: g.name })));

  const createMutation = useMutation({
    mutationFn: transactionsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transaction added");
      setAddOpen(false);
    },
    onError: () => toast.error("Failed to add transaction"),
  });

  const deleteMutation = useMutation({
    mutationFn: transactionsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transaction deleted");
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

  const totalPages = txnData ? Math.ceil(txnData.total / txnData.page_size) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Add</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
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
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txnData?.transactions.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="text-sm">{new Date(txn.date).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium">{txn.payee_name || "—"}</TableCell>
                      <TableCell>{txn.category_name ? <Badge variant="secondary">{txn.category_name}</Badge> : <span className="text-xs text-muted-foreground">Uncategorized</span>}</TableCell>
                      <TableCell className={`text-right font-mono ${Number(txn.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(Number(txn.amount))}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMutation.mutate(txn.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!txnData?.transactions.length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No transactions found</TableCell></TableRow>
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
