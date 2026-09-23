"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "@/lib/api/reports";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { SkeletonCard, SkeletonTable } from "@/components/skeleton-table";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { formatCurrency, formatCurrencyNegative, getMonthString, formatShortMonth, formatDate } from "@/lib/format";
import { useChartColors, useIsClient } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";
import { CURRENCY_AXIS_WIDTH, compactCurrencyTick } from "@/lib/reports/axis";
import { canGoForward, shiftMonth, spendingEmptyMonth } from "@/lib/reports/month-nav";
import { fillMonthGaps, summarizeBalances } from "@/lib/reports/series";
import { exportScope, type ReportTab } from "@/lib/reports/export-scope";

const REPORT_TABS: ReportTab[] = ["spending", "trends", "balances", "imports"];

/** Longest span the trend charts offer, and the window the month list uses. */
const TREND_RANGES = [6, 12, 24] as const;
type TrendRange = (typeof TREND_RANGES)[number];

function ChartPlaceholder({ height = 300, className }: { height?: number; className?: string }) {
  return (
    <div
      className={cn("w-full rounded-md bg-muted animate-pulse", className)}
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    />
  );
}

const moneyTooltip = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return [formatCurrency(Number.isFinite(n) ? n : 0), ""] as [string, string];
};

function SpendingTab({
  month,
  setMonth,
}: {
  month: string;
  setMonth: (m: string) => void;
}) {
  const isClient = useIsClient();
  const chartColors = useChartColors(15);

  const {
    data: spending = [],
    isLoading: spendingLoading,
    isError: spendingError,
    error: spendingQueryError,
    refetch: refetchSpending,
  } = useQuery({
    queryKey: ["spending-by-category", month],
    queryFn: () => reportsApi.spendingByCategory({ month }),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const {
    data: topPayees = [],
    isLoading: payeesLoading,
    isError: payeesError,
    error: payeesQueryError,
    refetch: refetchPayees,
  } = useQuery({
    queryKey: ["top-payees", month],
    queryFn: () => reportsApi.topPayees({ month }),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  // Which months have anything in them, so an empty month can point at one
  // that isn't instead of sending everyone to the import screen.
  const { data: monthly = [] } = useQuery({
    queryKey: ["spending-by-month", 24],
    queryFn: () => reportsApi.spendingByMonth(24),
    enabled: isClient,
  });
  const monthsWithSpending = useMemo(
    () => monthly.filter((m) => m.expenses !== 0).map((m) => m.month),
    [monthly],
  );

  const isLoading = spendingLoading || payeesLoading;
  const isError = spendingError || payeesError;
  const error = spendingError ? spendingQueryError : payeesQueryError;
  const refetch = () => {
    void refetchSpending();
    void refetchPayees();
  };

  const pieData = spending.map((s, i) => ({
    name: s.category_name,
    value: Math.abs(s.total),
    color: chartColors[i % chartColors.length],
  }));

  const monthTotal = spending.reduce((sum, s) => sum + Math.abs(s.total), 0);
  const empty = spendingEmptyMonth(month, monthsWithSpending);
  const forward = canGoForward(month);

  const monthLabel = new Date(Number(month.split("-")[0]), Number(month.split("-")[1]) - 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="w-44 text-center font-semibold">{monthLabel}</span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label="Next month"
          disabled={!forward}
          title={forward ? undefined : "This is the latest month there can be a report for"}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <QueryState
        isLoading={isLoading && spending.length === 0}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!isLoading && spending.length === 0}
        emptyTitle={empty.title}
        emptyDescription={empty.description}
        emptyAction={
          <div className="flex flex-wrap justify-center gap-2">
            {empty.jumpTo && (
              <Button size="sm" onClick={() => setMonth(empty.jumpTo!)}>
                Show {empty.jumpLabel}
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/transactions">Go to transactions</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/budget">Open budget</Link>
            </Button>
          </div>
        }
        loadingFallback={
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Spending by Category</CardTitle></CardHeader>
                <CardContent><ChartPlaceholder height={300} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Top Payees</CardTitle></CardHeader>
                <CardContent><SkeletonCard /></CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle>Category Breakdown</CardTitle></CardHeader>
              <CardContent><SkeletonTable rows={5} columns={3} /></CardContent>
            </Card>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Spending by Category</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(monthTotal)} across {spending.length} categor
                  {spending.length === 1 ? "y" : "ies"}
                </p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) =>
                        `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={moneyTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Top Payees</CardTitle></CardHeader>
              <CardContent>
                {topPayees.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No payee totals for this month</p>
                ) : (
                  <div className="space-y-1">
                    {topPayees.map((p, i) => (
                      <Link
                        key={i}
                        href={`/transactions?search=${encodeURIComponent(p.payee_name)}`}
                        className="-mx-2 flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{p.payee_name}</p>
                          <p className="text-xs text-muted-foreground">{p.count} transaction{p.count === 1 ? "" : "s"}</p>
                        </div>
                        <span className="ml-2 shrink-0 font-mono text-sm text-red-600">{formatCurrencyNegative(p.total)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Category Breakdown</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spending.map((s) => (
                    <TableRow key={s.category_id}>
                      <TableCell className="font-medium">{s.category_name}</TableCell>
                      <TableCell><Badge variant="outline">{s.group_name}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-red-600">{formatCurrencyNegative(s.total)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {monthTotal > 0 ? `${((Math.abs(s.total) / monthTotal) * 100).toFixed(0)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono">{formatCurrency(monthTotal)}</TableCell>
                    <TableCell className="text-right font-mono">100%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </QueryState>
    </div>
  );
}

function TrendsTab({
  range,
  setRange,
}: {
  range: TrendRange;
  setRange: (r: TrendRange) => void;
}) {
  const isClient = useIsClient();
  const {
    data: monthly = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["spending-by-month", range],
    queryFn: () => reportsApi.spendingByMonth(range),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  // Months with no activity are absent from the API response; charted raw
  // they close the gap and turn a quiet April into a straight line.
  const chartData = fillMonthGaps(monthly).map((m) => ({
    month: formatShortMonth(m.month),
    Income: m.income,
    Expenses: Math.abs(m.expenses),
    Net: m.net,
  }));

  const totals = chartData.reduce(
    (acc, m) => ({ income: acc.income + m.Income, expenses: acc.expenses + m.Expenses }),
    { income: 0, expenses: 0 },
  );
  const net = totals.income - totals.expenses;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Label htmlFor="trend-range" className="text-sm">Show</Label>
        <select
          id="trend-range"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={range}
          onChange={(e) => setRange(Number(e.target.value) as TrendRange)}
        >
          {TREND_RANGES.map((r) => (
            <option key={r} value={r}>last {r} months</option>
          ))}
        </select>
      </div>

      <QueryState
        isLoading={isLoading && monthly.length === 0}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!isLoading && monthly.length === 0}
        emptyTitle="No trend data yet"
        emptyDescription="Import or add transactions to build income and expense trends over time."
        emptyAction={
          <Button variant="outline" size="sm" asChild>
            <Link href="/transactions">Go to transactions</Link>
          </Button>
        }
        loadingFallback={
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Income vs Expenses</CardTitle></CardHeader>
              <CardContent><ChartPlaceholder height={350} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Net Income Trend</CardTitle></CardHeader>
              <CardContent><ChartPlaceholder height={250} /></CardContent>
            </Card>
          </div>
        }
      >
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Income vs Expenses</CardTitle>
              <p className="text-sm text-muted-foreground">
                {chartData.length > 0 && (
                  <>
                    {chartData[0].month} – {chartData[chartData.length - 1].month}:{" "}
                  </>
                )}
                took in {formatCurrency(totals.income)}, spent{" "}
                {formatCurrency(totals.expenses)} —{" "}
                <span className={net >= 0 ? "text-green-600" : "text-red-600"}>
                  {net >= 0 ? "keeping " : "short by "}
                  {formatCurrency(Math.abs(net))}
                </span>
                .
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" width={CURRENCY_AXIS_WIDTH} tickFormatter={compactCurrencyTick} />
                  <Tooltip formatter={moneyTooltip} />
                  <Legend />
                  <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Net Income Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" width={CURRENCY_AXIS_WIDTH} tickFormatter={compactCurrencyTick} />
                  <Tooltip formatter={moneyTooltip} />
                  <Line type="monotone" dataKey="Net" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </QueryState>
    </div>
  );
}

function BalanceHistoryTab({
  accountId,
  setAccountId,
}: {
  accountId: string;
  setAccountId: (id: string) => void;
}) {
  const isClient = useIsClient();
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });

  // Making someone pick the only account they have is a step that asks a
  // question it already knows the answer to.
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accountId, accounts, setAccountId]);

  const {
    data: history = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["balance-history", accountId],
    queryFn: () => reportsApi.balanceHistory(accountId),
    enabled: isClient && !!accountId,
    meta: inlineErrorQueryMeta,
  });

  const chartData = history.map((h) => ({
    date: formatDate(h.date, { month: "short", day: "numeric" }),
    Balance: h.balance,
  }));
  const summary = summarizeBalances(history);
  const account = accounts.find((a: Account) => a.id === accountId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Label htmlFor="balance-account" className="text-sm">Account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger id="balance-account" className="w-64" aria-label="Account to show balance history for">
            <SelectValue placeholder={accountsLoading ? "Loading accounts…" : "Select an account"} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a: Account) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={(accountsLoading || isLoading) && chartData.length === 0 && !!accountId}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!isLoading && (!accountId || history.length === 0)}
        emptyTitle={
          accounts.length === 0
            ? "No accounts yet"
            : !accountId
              ? "Pick an account"
              : `No balance history for ${account?.name ?? "this account"}`
        }
        emptyDescription={
          accounts.length === 0
            ? "Balance history is built from an account's transactions, so there is nothing to plot until you add one."
            : !accountId
              ? "Choose an account above to see how its balance moved."
              : "Balance history is built from this account's transactions. Import or add some and the line appears here."
        }
        emptyAction={
          <Button variant="outline" size="sm" asChild>
            <Link href={accounts.length === 0 ? "/accounts" : "/transactions"}>
              {accounts.length === 0 ? "Add an account" : "Go to transactions"}
            </Link>
          </Button>
        }
        loadingFallback={
          <Card>
            <CardHeader><CardTitle>Balance History</CardTitle></CardHeader>
            <CardContent><ChartPlaceholder height={350} /></CardContent>
          </Card>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>Balance History</CardTitle>
            {summary && (
              <p className="text-sm text-muted-foreground">
                {formatCurrency(summary.start)} on {formatDate(summary.from)} →{" "}
                {formatCurrency(summary.end)} on {formatDate(summary.to)} ·{" "}
                <span className={summary.change >= 0 ? "text-green-600" : "text-red-600"}>
                  {summary.change >= 0 ? "up " : "down "}
                  {formatCurrency(Math.abs(summary.change))}
                </span>{" "}
                · low {formatCurrency(summary.low)}
              </p>
            )}
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" width={CURRENCY_AXIS_WIDTH} tickFormatter={compactCurrencyTick} />
                <Tooltip formatter={moneyTooltip} />
                <Line type="monotone" dataKey="Balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </QueryState>
    </div>
  );
}

function ImportsTab() {
  const isClient = useIsClient();
  const { data: imports = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["imports"],
    queryFn: reportsApi.imports,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Import History</CardTitle></CardHeader>
      <CardContent>
        <QueryState
          isLoading={isLoading && imports.length === 0}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          isEmpty={!isLoading && imports.length === 0}
          emptyTitle="No imports yet"
          emptyDescription="Import a CSV from Transactions or connect accounts in Settings."
          emptyAction={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/transactions">Go to transactions</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings#bank">Open settings</Link>
              </Button>
            </div>
          }
          loadingFallback={<SkeletonTable rows={4} columns={5} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((imp) => (
                <TableRow key={imp.id}>
                  <TableCell>{new Date(imp.imported_at).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{imp.account_name}</TableCell>
                  <TableCell><Badge variant="outline">{imp.source}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-48">{imp.filename || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{imp.transaction_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </QueryState>
      </CardContent>
    </Card>
  );
}

function ReportsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isClient = useIsClient();

  const tabParam = searchParams.get("tab");
  const tab: ReportTab = REPORT_TABS.includes((tabParam ?? "") as ReportTab)
    ? (tabParam as ReportTab)
    : "spending";

  const [month, setMonth] = useState(() => getMonthString(new Date()));
  const [range, setRange] = useState<TrendRange>(12);
  const [accountId, setAccountId] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { data: monthly = [] } = useQuery({
    queryKey: ["spending-by-month", range],
    queryFn: () => reportsApi.spendingByMonth(range),
    enabled: isClient,
  });

  const scope = exportScope({
    tab,
    month,
    trendMonths: monthly.map((m) => m.month).sort(),
    accountId,
    accountName: accounts.find((a: Account) => a.id === accountId)?.name ?? "",
  });

  // Exporting every transaction you have ever had, whatever is on screen,
  // is the wrong answer often enough to be a trap -- so the button follows
  // the view, and says what it is about to download.
  const handleExport = async () => {
    setExporting(true);
    let url: string | null = null;
    try {
      const blob = await reportsApi.exportCsv(scope.params);
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = scope.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      appToast.success(`Exported ${scope.label}`);
    } catch (e) {
      toastApiError("Export failed", e);
    } finally {
      // Revoking before the browser has read the blob cancels the download.
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 10_000);
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        actions={
          <Button variant="outline" onClick={handleExport} disabled={exporting} title={`Downloads ${scope.label}`}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => router.replace(`/reports?tab=${v}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="spending">Spending</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
        </TabsList>
        <TabsContent value="spending" className="mt-6">
          <SpendingTab month={month} setMonth={setMonth} />
        </TabsContent>
        <TabsContent value="trends" className="mt-6">
          <TrendsTab range={range} setRange={setRange} />
        </TabsContent>
        <TabsContent value="balances" className="mt-6">
          <BalanceHistoryTab accountId={accountId} setAccountId={setAccountId} />
        </TabsContent>
        <TabsContent value="imports" className="mt-6">
          <ImportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-10 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        </div>
      }
    >
      <ReportsContent />
    </Suspense>
  );
}
