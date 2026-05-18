"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { transactionsApi } from "@/lib/api/transactions";
import { budgetApi } from "@/lib/api/budget";
import { reportsApi } from "@/lib/api/reports";
import { goalsApi, type FinancialGoal } from "@/lib/api/goals";
import { aiApi } from "@/lib/api/ai";
import { syncApi } from "@/lib/api/sync";
import { recurringApi } from "@/lib/api/recurring";
import { settingsApi } from "@/lib/api/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, Target,
  Sparkles, Lightbulb, RefreshCw, Cpu, ChevronDown,
  Plug, Plus, Upload, X, Settings, WifiOff,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { formatCurrency, formatCurrencyNegative, getMonthString, navigateMonth, formatShortMonth } from "@/lib/format";
import { useIsClient, getApiErrorMessage, useChartColors, useInView } from "@/lib/hooks";
import { QueryState, inlineErrorQueryMeta } from "@/components/page";
import { toastApiError } from "@/lib/toast-error";
import { PageHeader } from "@/components/page";
import { SetupChecklist } from "@/components/setup-checklist";
import { NextBestAction } from "@/components/next-best-action";
import { CycleReviewSection } from "@/components/cycle-review-section";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { appToast } from "@/lib/app-toast";
import { shouldShowMobileSyncBanner } from "@/lib/ux-plan-logic";
import { AI_COPY } from "@/lib/ai-copy";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";

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
  const gate = useAiFeatureGate();
  const [open, setOpen] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const lastInvalidatedSyncRef = useRef<string | null>(null);
  const panelId = useId();

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["aiInsights"],
    queryFn: aiApi.getInsights,
    staleTime: 5 * 60 * 1000,
    enabled: isClient && open && aiReady && hasFinancialData,
    retry: false,
  });

  const toggleOpen = async () => {
    if (!open) {
      const prepared = await gate.prepareFeature("financial_advice");
      if (!prepared.ok) return;
      setAiReady(true);
    }
    setOpen((o) => !o);
  };

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
        type="button"
        className="w-full text-left"
        onClick={() => void toggleOpen()}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle id={`${panelId}-label`} className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-purple-500" aria-hidden /> AI Suggestions
          </CardTitle>
          <div className="flex items-center gap-2">
            {(data?.model_source === "ollama" || data?.model_source === "demo") && (
              <Badge variant="outline" className="text-xs gap-1">
                {data.model_source === "ollama"
                  ? <><Cpu className="h-2.5 w-2.5" /> Local AI</>
                  : <><Sparkles className="h-2.5 w-2.5" /> Demo</>}
              </Badge>
            )}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
        </CardHeader>
      </button>
      {open && (
        <CardContent id={panelId} role="region" aria-labelledby={`${panelId}-label`}>
          {!hasFinancialData ? (
            <p className="text-sm text-muted-foreground">
              Connect and sync your bank (or add accounts and transactions) to get personalized AI suggestions based on your data.
            </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Grounded in your categories and balances—toggle AI off anytime in Settings if you prefer a fully manual app.{" "}
                    {AI_COPY.educationalDisclaimer}
                  </p>
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
                    <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                      <Link href="/settings">
                        <Settings className="h-3 w-3 mr-1" /> Enable AI in Settings
                      </Link>
                    </Button>
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
      <h2 className="text-base font-semibold mb-1">Welcome to Clarity</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Add accounts manually, import a CSV, or connect read-only bank sync (SimpleFIN)—your choice.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link href="/settings">
            <Plug className="h-4 w-4 text-primary" /> Connect bank (read-only via SimpleFIN)
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link href="/accounts">
            <Plus className="h-4 w-4 text-primary" /> Add account manually
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link href="/transactions">
            <Upload className="h-4 w-4 text-primary" /> Import CSV
          </Link>
        </Button>
      </div>
    </div>
  );
}

function sumCategorySpend(rows: { total: number }[]): number {
  return rows.reduce((acc, s) => acc + Math.abs(Number(s.total)), 0);
}

function DashboardContent() {
  const currentMonth = getMonthString(new Date());
  const prevMonth = navigateMonth(currentMonth, -1);
  const isClient = useIsClient();
  const chartColors = useChartColors(8);
  const queryClient = useQueryClient();
  const { ref: chartsSectionRef, inView: chartsInView } = useInView();

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

  const syncMutation = useMutation({
    mutationFn: syncApi.trigger,
    onSuccess: () => {
      appToast.success("Sync started");
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    },
    onError: (e) => toastApiError("Failed to start sync", e),
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
  const { data: paySchedule, isSuccess: payScheduleLoaded } = useQuery({
    queryKey: ["paySchedule"],
    queryFn: settingsApi.getPaySchedule,
    enabled: isClient,
  });
  const spendByPayCycle = payScheduleLoaded && !!paySchedule;
  const cycleFrom = paySchedule?.cycle.date_from;
  const cycleTo = paySchedule?.cycle.date_to;
  const reflectiveFraming = paySchedule?.budget_framing === "reflective";

  const {
    data: spending = [],
    isLoading: spendingLoading,
    isError: spendingError,
    error: spendingErr,
    refetch: refetchSpending,
  } = useQuery({
    queryKey: spendByPayCycle
      ? ["spending-by-category", "pay-cycle", cycleFrom, cycleTo]
      : ["spending-by-category", currentMonth],
    queryFn: () =>
      spendByPayCycle
        ? reportsApi.spendingByCategory({ date_from: cycleFrom!, date_to: cycleTo! })
        : reportsApi.spendingByCategory({ month: currentMonth }),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });
  const { data: goals = [] } = useQuery({
    queryKey: ["goals"],
    queryFn: goalsApi.list,
    enabled: isClient,
  });
  const { data: spendingPrev = [], isLoading: spendingPrevLoading } = useQuery({
    queryKey: ["spending-by-category", prevMonth],
    queryFn: () => reportsApi.spendingByCategory({ month: prevMonth }),
    enabled: isClient && chartsInView,
    meta: inlineErrorQueryMeta,
  });
  const {
    data: cashFlowMonths = [],
    isLoading: cashFlowLoading,
    isError: cashFlowError,
    error: cashFlowErr,
    refetch: refetchCashFlow,
  } = useQuery({
    queryKey: ["spending-by-month", "dash", 6],
    queryFn: () => reportsApi.spendingByMonth(6),
    enabled: isClient && chartsInView,
    meta: inlineErrorQueryMeta,
  });
  const {
    data: recurringList = [],
    isLoading: recurringLoading,
    isError: recurringError,
    error: recurringErr,
    refetch: refetchRecurring,
  } = useQuery({
    queryKey: ["recurring"],
    queryFn: recurringApi.list,
    enabled: isClient && chartsInView,
    meta: inlineErrorQueryMeta,
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
    color: chartColors[i % chartColors.length],
  }));

  const spendThisMonth = sumCategorySpend(spending);
  const spendPrevMonth = sumCategorySpend(spendingPrev);
  const spendMomPct =
    spendPrevMonth > 0.01
      ? ((spendThisMonth - spendPrevMonth) / spendPrevMonth) * 100
      : null;

  const cashFlowChart = cashFlowMonths.map((m) => ({
    month: formatShortMonth(m.month),
    expenses: Math.abs(m.expenses),
    income: m.income,
  }));

  const soonRecurring = [...recurringList]
    .filter((r) => {
      const d = new Date(r.next_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + 45);
      return d >= today && d <= horizon;
    })
    .slice(0, 5);

  const showDesktopStaleHint =
    accounts.length > 0 &&
    syncStatus?.is_stale &&
    !syncStatus?.syncing &&
    !shouldShowMobileSyncBanner(syncStatus?.last_sync ?? undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <>
            {payScheduleLoaded && paySchedule && (
              <span>
                <span className="font-medium text-foreground">Spend window:</span>{" "}
                {paySchedule.cycle.label}
                {paySchedule.cycle.next_pay_date ? (
                  <>
                    {" "}
                    · Next pay ~{" "}
                    {new Date(paySchedule.cycle.next_pay_date + "T12:00:00").toLocaleDateString()}
                  </>
                ) : null}
                .{" "}
                <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
                  Pay schedule
                </Link>
              </span>
            )}
            {showDesktopStaleHint && (
              <span className="hidden md:block mt-1">
                Figures may not include your latest bank activity.{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-sm font-medium"
                  disabled={syncMutation.isPending}
                  onClick={() => syncMutation.mutate()}
                >
                  Sync now
                </Button>
              </span>
            )}
          </>
        }
      />

      {/* First-run welcome banner */}
      {accounts.length === 0 && <WelcomeBanner />}

      <SetupChecklist className="mt-2" />

      <NextBestAction className="mt-2" />

      {accounts.length > 0 && <CycleReviewSection className="mt-2" />}

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
                <p className="text-xs text-muted-foreground mt-1">{debtAccounts.length} account{debtAccounts.length > 1 ? "s" : ""} · open debt plan</p>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/budget">
          <Card
            className={cn(
              "hover:border-primary/50 transition-colors cursor-pointer",
              reflectiveFraming && "opacity-90",
            )}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {reflectiveFraming ? "Ready to assign (calendar month)" : "Ready to Assign"}
              </CardTitle>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className={cn("text-2xl font-bold", readyToAssign > 0 ? "text-green-600" : readyToAssign < 0 ? "text-red-600" : "")}>
                {formatCurrency(readyToAssign)}
              </p>
              {reflectiveFraming && (
                <p className="text-xs text-muted-foreground mt-1">Envelope totals use the budget month, not the pay window above.</p>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {accounts.length > 0 && (
        <div ref={chartsSectionRef} className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cash flow (recent months)</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryState
                isLoading={cashFlowLoading && cashFlowMonths.length === 0}
                isError={cashFlowError}
                error={cashFlowErr}
                onRetry={() => refetchCashFlow()}
                isEmpty={!cashFlowLoading && cashFlowChart.length === 0}
                emptyDescription="Import or sync transactions to see income and spending by month."
                loadingFallback={
                  <div className="h-[220px] animate-pulse rounded-md bg-muted" />
                }
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={cashFlowChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} width={44} />
                    <Tooltip
                      formatter={(value, name) => [
                        formatCurrency(typeof value === "number" ? value : 0),
                        name ?? "",
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Income" fill={chartColors[0]} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill={chartColors[1]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </QueryState>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Upcoming recurring</CardTitle>
              <Link href="/recurring" className="text-xs text-primary hover:underline">
                Manage
              </Link>
            </CardHeader>
            <CardContent>
              <QueryState
                isLoading={recurringLoading && recurringList.length === 0}
                isError={recurringError}
                error={recurringErr}
                onRetry={() => refetchRecurring()}
                isEmpty={!recurringLoading && soonRecurring.length === 0}
                emptyDescription={
                  <>
                    No recurring items in the next 45 days.{" "}
                    <Link href="/recurring" className="text-primary underline">Add one</Link>
                  </>
                }
                loadingFallback={
                  <div className="space-y-2 py-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-4 animate-pulse rounded bg-muted" />
                    ))}
                  </div>
                }
              >
                <ul className="space-y-2 text-sm">
                  {soonRecurring.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {r.payee_name ?? "Recurring"}
                        {r.category_name ? (
                          <span className="text-muted-foreground"> · {r.category_name}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatCurrency(r.amount)} · {new Date(r.next_date).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </QueryState>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Spending pie */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>
              {payScheduleLoaded && paySchedule
                ? paySchedule.cycle.is_fallback_30d
                  ? "Spending (last 30 days)"
                  : "Spending this pay period"
                : "Spending this month"}
            </CardTitle>
            {payScheduleLoaded && paySchedule && (
              <p className="text-xs text-muted-foreground font-normal mt-1">{paySchedule.cycle.label}</p>
            )}
          </CardHeader>
          <CardContent>
            <QueryState
              isLoading={spendingLoading && spending.length === 0}
              isError={spendingError}
              error={spendingErr}
              onRetry={() => refetchSpending()}
              isEmpty={!spendingLoading && pieData.length === 0}
              emptyDescription="No spending in this window yet."
              emptyAction={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/transactions">Add or import transactions</Link>
                </Button>
              }
              loadingFallback={
                <div className="h-[180px] animate-pulse rounded-md bg-muted" />
              }
            >
              <>
                {spendMomPct !== null && spendPrevMonth > 0.01 && !spendingPrevLoading && (
                  <p className="text-xs text-muted-foreground mb-2">
                    <span className="font-medium text-foreground">vs prior calendar month:</span>{" "}
                    {spendMomPct > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {spendMomPct.toFixed(0)}% more spending
                      </span>
                    ) : spendMomPct < 0 ? (
                      <span className="text-green-700 dark:text-green-400">
                        {Math.abs(spendMomPct).toFixed(0)}% less spending
                      </span>
                    ) : (
                      "about the same"
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      ({formatCurrency(spendThisMonth)} vs {formatCurrency(spendPrevMonth)})
                    </span>
                  </p>
                )}
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v: number | undefined) => {
                        const n = typeof v === "number" ? v : Number(v);
                        return [formatCurrency(Number.isFinite(n) ? n : 0), ""];
                      }}
                    />
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
            </QueryState>
          </CardContent>
        </Card>

        {/* Accounts */}
        <Card>
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-muted-foreground">No accounts yet.</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/accounts">Add an account</Link>
                </Button>
              </div>
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
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-muted-foreground">No transactions yet.</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/transactions">Go to transactions</Link>
                </Button>
              </div>
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
                    <p className="font-mono font-medium text-foreground tabular-nums">
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
  return <DashboardContent />;
}
