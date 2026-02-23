"use client";

import { AuthGuard } from "@/components/auth-guard";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { transactionsApi } from "@/lib/api/transactions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, TrendingDown, ArrowLeftRight } from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function DashboardContent() {
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: accountsApi.list });
  const { data: recentTxns } = useQuery({
    queryKey: ["transactions", "recent"],
    queryFn: () => transactionsApi.list({ page_size: 10 }),
  });

  const totalAssets = accounts
    .filter((a: Account) => !["credit", "loan"].includes(a.account_type))
    .reduce((sum: number, a: Account) => sum + Number(a.balance), 0);

  const totalLiabilities = accounts
    .filter((a: Account) => ["credit", "loan"].includes(a.account_type))
    .reduce((sum: number, a: Account) => sum + Math.abs(Number(a.balance)), 0);

  const netWorth = totalAssets - totalLiabilities;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Worth</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${netWorth >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(netWorth)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assets</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(totalAssets)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Liabilities</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(totalLiabilities)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Accounts</CardTitle>
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{accounts.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No accounts yet. Add one to get started.</p>
            ) : (
              <div className="space-y-3">
                {accounts.map((acct: Account) => (
                  <div key={acct.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{acct.name}</p>
                      <p className="text-xs text-muted-foreground">{acct.institution || acct.account_type}</p>
                    </div>
                    <p className={`font-mono font-medium ${Number(acct.balance) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(Number(acct.balance))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {!recentTxns?.transactions.length ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <div className="space-y-3">
                {recentTxns.transactions.map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{txn.payee_name || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(txn.date).toLocaleDateString()} {txn.category_name && `· ${txn.category_name}`}
                      </p>
                    </div>
                    <p className={`font-mono font-medium ${Number(txn.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(Number(txn.amount))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
