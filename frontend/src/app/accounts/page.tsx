"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { accountsApi, type Account, type AccountCreate } from "@/lib/api/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "loan", label: "Loan" },
  { value: "investment", label: "Investment" },
  { value: "property", label: "Property" },
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function AccountsContent() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AccountCreate>({
    name: "",
    account_type: "checking",
    institution: "",
    starting_balance: 0,
  });

  const queryClient = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ["accounts"], queryFn: accountsApi.list });

  const createMutation = useMutation({
    mutationFn: accountsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account created");
      setOpen(false);
      setForm({ name: "", account_type: "checking", institution: "", starting_balance: 0 });
    },
    onError: () => toast.error("Failed to create account"),
  });

  const deleteMutation = useMutation({
    mutationFn: accountsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account deleted");
    },
  });

  const grouped = ACCOUNT_TYPES.map((type) => ({
    ...type,
    accounts: accounts.filter((a: Account) => a.account_type === type.value),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Accounts</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Institution</Label>
                <Input value={form.institution || ""} onChange={(e) => setForm({ ...form, institution: e.target.value })} placeholder="e.g. Chase, Wells Fargo" />
              </div>
              <div className="space-y-2">
                <Label>Starting Balance</Label>
                <Input type="number" step="0.01" value={form.starting_balance || ""} onChange={(e) => setForm({ ...form, starting_balance: parseFloat(e.target.value) || 0 })} />
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Account"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No accounts yet. Add your first account to get started.</p>
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => (
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
                    </div>
                    {acct.simplefin_id && <Badge variant="outline" className="text-xs">Linked</Badge>}
                  </div>
                  <div className="flex items-center gap-3">
                    <p className={`font-mono text-lg font-semibold ${Number(acct.balance) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(Number(acct.balance))}
                    </p>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(acct.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

export default function AccountsPage() {
  return <AuthGuard><AccountsContent /></AuthGuard>;
}
