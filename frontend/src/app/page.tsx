"use client";

import { useState, useRef, useEffect } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { transactionsApi } from "@/lib/api/transactions";
import { budgetApi } from "@/lib/api/budget";
import { reportsApi } from "@/lib/api/reports";
import { goalsApi, type FinancialGoal } from "@/lib/api/goals";
import { aiApi } from "@/lib/api/ai";
import { syncApi } from "@/lib/api/sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, Target,
  Sparkles, Lightbulb, RefreshCw, Cpu, Cloud, ChevronDown,
  Plug, Plus, Upload, X, Settings, WifiOff,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { formatCurrency, formatCurrencyNegative, getMonthString } from "@/lib/format";
import { useIsClient, getApiErrorMessage } from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

const COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

const DEBT_TYPES = ["credit", "loan"];

function accountBalanceClass(account: Account): string {
  return Number(account.balance) >= 0 ? "text-green-600" : "text-red-600";
}

function formatAccountBalance(account: Account): string {
  return formatCurrency(Number(account.balance));
}

function InsightsPanel({
  hasFinancialData,
  onSyncCompletedAt,
}: {
  hasFinancialData: boolean;
  onSyncCompletedAt: string | null;
}) {
  const isClient = useIsClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const lastInvalidatedSyncRef = useRef<string | null>(null);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["aiInsights"],
    queryFn: aiApi.getInsights,
    staleTime: 5 * 60 * 1000,
    enabled: isClient && open && hasFinancialData,
    retry: false,
  });

  // Invalidate AI insights when a sync has just completed so suggestions reflect latest data
  useEffect(() => {
    if (!onSyncCompletedAt || !hasFinancialData) return;
    if (lastInvalidatedSyncRef.current === onSyncCompletedAt) return;
    lastInvalidatedSyncRef.current = onSyncCompletedAt;
    queryClient.invalidateQueries({ queryKey: ["aiInsights"] });
  }, [onSyncCompletedAt, hasFinancialData, queryClient]);

  return (
    <Card>
      <button
        className="w-full text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-purple-500" /> AI Suggestions
          </CardTitle>
          <div className="flex items-center gap-2">
            {data?.model_source && (
              <Badge variant="outline" className="text-xs gap-1">
                {data.model_source === "ollama"
                  ? <><Cpu className="h-2.5 w-2.5" /> Local AI</>
                  : <><Cloud className="h-2.5 w-2.5" /> Claude</>}
              </Badge>
            )}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </CardHeader>
      </button>
      {open && (
        <CardContent>
          {!hasFinancialData ? (
            <p className="text-sm text-muted-foreground">
              Connect and sync your bank (or add accounts and transactions) to get personalised AI suggestions based on your data.
            </p>
          ) : (
            <>
              <div className="flex justify-end mb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    refetch();
                  }}
                  disabled={isFetching}
                  className="h-7 text-xs"
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
                  Refresh
                </Button>
              </div>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-4 bg-muted animate-pulse rounded" />)}
                </div>
              ) : isError ? (
                <div className="space-y-2 text-sm">
                  <p className="text-destructive flex items-center gap-2">
                    <WifiOff className="h-4 w-4 shrink-0" />
                    {getApiErrorMessage(error, "Failed to load AI suggestions.")}
                  </p>
                  {(error as { response?: { status?: number } })?.response?.status === 403 && (
                    <Link href="/settings">
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <Settings className="h-3 w-3 mr-1" /> Enable AI in Settings
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">
                  {data?.insights?.length ? (
                    data.insights.map((insight, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <span>{insight}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">No insights yet. Add more transactions and refresh.</li>
                  )}
                </ul>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const WELCOME_DISMISSED_KEY = "budget_welcome_dismissed";

function WelcomeBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(WELCOME_DISMISSED_KEY) === "1";
  });

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="relative rounded-xl border border-primary/20 bg-primary/5 p-5">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="text-base font-semibold mb-1">Welcome! Let&apos;s get your accounts set up.</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect your bank, add accounts manually, or import a CSV to get started.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/settings">
          <button className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
            <Plug className="h-4 w-4 text-primary" /> Connect bank (SimpleFIN)
          </button>
        </Link>
        <Link href="/accounts">
          <button className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
            <Plus className="h-4 w-4 text-primary" /> Add account manually
          </button>
        </Link>
        <Link href="/transactions">
          <button className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
            <Upload className="h-4 w-4 text-primary" /> Import CSV
          </button>
        </Link>
      </div>
    </div>
  );
}

function DashboardContent() {
  const currentMonth = getMonthString(new Date());
  const isClient = useIsClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    enabled: isClient,
  });
  const { data: recentTxns } = useQuery({
    queryKey: ["transactions", "recent"],
    queryFn: () => transactionsApi.list({ page_size: 8 }),
    enabled: isClient,
  });
  const { data: budgetData } = useQuery({
    queryKey: ["budget", currentMonth],
    queryFn: () => budgetApi.getMonth(currentMonth),
    enabled: isClient,
  });
  const { data: spending = [] } = useQuery({
    queryKey: ["spending-by-category", currentMonth],
    queryFn: () => reportsApi.spendingByCategory({ month: currentMonth }),
    enabled: isClient,
  });
  const { data: goals = [] } = useQuery({
    queryKey: ["goals"],
    queryFn: goalsApi.list,
    enabled: isClient,
  });

  const totalAssets = accounts
    .filter((a: Account) => !DEBT_TYPES.includes(a.account_type))
    .reduce((sum: number, a: Account) => sum + Number(a.balance), 0);

  const totalLiabilities = accounts
    .filter((a: Account) => DEBT_TYPES.includes(a.account_type))
    .reduce((sum: number, a: Account) => sum + Math.abs(Number(a.balance)), 0);

  const netWorth = totalAssets - totalLiabilities;
  const readyToAssign = (budgetData?.total_income ?? 0) - (budgetData?.total_assigned ?? 0);

  const debtAccounts = accounts.filter((a: Account) => DEBT_TYPES.includes(a.account_type));
  const activeGoals = goals.filter((g: FinancialGoal) => !g.is_completed).slice(0, 3);

  const pieData = spending.slice(0, 8).map((s, i) => ({
    name: s.category_name,
    value: Math.abs(s.total),
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* First-run welcome banner */}
      {accounts.length === 0 && <WelcomeBanner />}

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Worth</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className={cn("text-2xl font-bold", netWorth >= 0 ? "text-green-600" : "text-red-600")}>
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
            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalAssets)}</p>
          </CardContent>
        </Card>

        <Link href="/plan?tab=debt">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Debt</CardTitle>
              <TrendingDown className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{formatCurrencyNegative(totalLiabilities)}</p>
              {debtAccounts.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{debtAccounts.length} account{debtAccounts.length > 1 ? "s" : ""} · tap to plan payoff</p>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/budget">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Ready to Assign</CardTitle>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className={cn("text-2xl font-bold", readyToAssign > 0 ? "text-green-600" : readyToAssign < 0 ? "text-red-600" : "")}>
                {formatCurrency(readyToAssign)}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Spending pie */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Spending This Month</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No spending data</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {pieData.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-muted-foreground truncate max-w-32">{s.name}</span>
                      </div>
                      <span className="font-mono text-xs">{formatCurrency(s.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Accounts */}
        <Card>
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No accounts yet.</p>
            ) : (
              <div className="space-y-3">
                {accounts.map((acct: Account) => (
                  <div key={acct.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{acct.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {acct.institution || acct.account_type}
                        {DEBT_TYPES.includes(acct.account_type) && " · owed"}
                      </p>
                    </div>
                    <p className={cn("font-mono font-medium", accountBalanceClass(acct))}>
                      {formatAccountBalance(acct)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card>
          <CardHeader><CardTitle>Recent Transactions</CardTitle></CardHeader>
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
                    <p className={cn("font-mono font-medium", Number(txn.amount) >= 0 ? "text-green-600" : "text-red-600")}>
                      {formatCurrency(Number(txn.amount))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <InsightsPanel
        hasFinancialData={accounts.length > 0}
        onSyncCompletedAt={
          syncStatus?.last_sync?.status === "success" && syncStatus?.last_sync?.completed_at
            ? syncStatus.last_sync.completed_at
            : null
        }
      />

      {/* Goals progress */}
      {activeGoals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-purple-500" /> Goals
            </h2>
            <Link href="/plan?tab=goals" className="text-sm text-primary hover:underline">View all</Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {activeGoals.map((g: FinancialGoal) => {
              const pct = Math.min(100, g.progress_pct);
              return (
                <Card key={g.id}>
                  <CardContent className="pt-4 space-y-2">
                    <p className="font-medium text-sm">{g.name}</p>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatCurrency(g.current_amount)}</span>
                      <span>{formatCurrency(g.target_amount)}</span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-xs text-muted-foreground text-right">{pct.toFixed(0)}% complete</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
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
