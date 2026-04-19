"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "@/lib/api/reports";
import { accountsApi, type Account } from "@/lib/api/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { SkeletonTable } from "@/components/skeleton-table";
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
import { formatCurrency, formatCurrencyNegative, getMonthString, formatShortMonth } from "@/lib/format";
import { useIsClient } from "@/lib/hooks";

const COLORS = [
  "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
  "#e11d48", "#84cc16", "#a855f7", "#0ea5e9", "#d946ef",
];

function SpendingTab() {
  const [month, setMonth] = useState(() => getMonthString(new Date()));
  const isClient = useIsClient();

  const { data: spending = [] } = useQuery({
    queryKey: ["spending-by-category", month],
    queryFn: () => reportsApi.spendingByCategory({ month }),
    enabled: isClient,
  });

  const { data: topPayees = [] } = useQuery({
    queryKey: ["top-payees", month],
    queryFn: () => reportsApi.topPayees({ month }),
    enabled: isClient,
  });

  const pieData = spending.map((s, i) => ({
    name: s.category_name,
    value: Math.abs(s.total),
    color: COLORS[i % COLORS.length],
  }));

  const nav = (delta: number) => {
    const [y, m] = month.split("-");
    const d = new Date(Number(y), Number(m) - 1 + delta);
    setMonth(getMonthString(d));
  };

  const monthLabel = new Date(Number(month.split("-")[0]), Number(month.split("-")[1]) - 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="w-44 text-center font-semibold">{monthLabel}</span>
        <Button variant="outline" size="icon" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Spending by Category</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No spending data</p>
            ) : (
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
                  <Tooltip
                    formatter={(v: number | undefined) => {
                      const n = typeof v === "number" ? v : Number(v);
                      return [formatCurrency(Number.isFinite(n) ? n : 0), ""];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top Payees</CardTitle></CardHeader>
          <CardContent>
            {topPayees.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data</p>
            ) : (
              <div className="space-y-3">
                {topPayees.map((p, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{p.payee_name}</p>
                      <p className="text-xs text-muted-foreground">{p.count} transactions</p>
                    </div>
                    <span className="font-mono text-sm text-red-600">{formatCurrencyNegative(p.total)}</span>
                  </div>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {spending.map((s) => (
                <TableRow key={s.category_id}>
                  <TableCell className="font-medium">{s.category_name}</TableCell>
                  <TableCell><Badge variant="outline">{s.group_name}</Badge></TableCell>
                  <TableCell className="text-right font-mono text-red-600">{formatCurrencyNegative(s.total)}</TableCell>
                </TableRow>
              ))}
              {spending.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No spending data</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TrendsTab() {
  const isClient = useIsClient();
  const { data: monthly = [] } = useQuery({
    queryKey: ["spending-by-month", 12],
    queryFn: () => reportsApi.spendingByMonth(12),
    enabled: isClient,
  });

  const chartData = monthly.map((m) => ({
    month: formatShortMonth(m.month),
    Income: m.income,
    Expenses: Math.abs(m.expenses),
    Net: m.net,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Income vs Expenses</CardTitle></CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number | undefined) => {
                    const n = typeof v === "number" ? v : Number(v);
                    return [formatCurrency(Number.isFinite(n) ? n : 0), ""];
                  }}
                />
                <Legend />
                <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Net Income Trend</CardTitle></CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number | undefined) => {
                    const n = typeof v === "number" ? v : Number(v);
                    return [formatCurrency(Number.isFinite(n) ? n : 0), ""];
                  }}
                />
                <Line type="monotone" dataKey="Net" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceHistoryTab() {
  const isClient = useIsClient();
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const [selectedAccount, setSelectedAccount] = useState<string>("");

  const { data: history = [] } = useQuery({
    queryKey: ["balance-history", selectedAccount],
    queryFn: () => reportsApi.balanceHistory(selectedAccount),
    enabled: isClient && !!selectedAccount,
  });

  const chartData = history.map((h) => ({
    date: new Date(h.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    Balance: h.balance,
  }));

  return (
    <div className="space-y-6">
      <Select value={selectedAccount} onValueChange={setSelectedAccount}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Select an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a: Account) => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Card>
        <CardHeader><CardTitle>Balance History</CardTitle></CardHeader>
        <CardContent>
          {!selectedAccount ? (
            <p className="text-center text-muted-foreground py-8">Select an account to view history</p>
          ) : chartData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No history data</p>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => formatCurrency(v)} />
                <Tooltip
                  formatter={(v: number | undefined) => {
                    const n = typeof v === "number" ? v : Number(v);
                    return [formatCurrency(Number.isFinite(n) ? n : 0), ""];
                  }}
                />
                <Line type="monotone" dataKey="Balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImportsTab() {
  const isClient = useIsClient();
  const { data: imports = [], isLoading } = useQuery({
    queryKey: ["imports"],
    queryFn: reportsApi.imports,
    enabled: isClient,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Import History</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <SkeletonTable rows={4} columns={5} /> : imports.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No imports yet</p>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
}

function ReportsContent() {
  const handleExport = async () => {
    try {
      const blob = await reportsApi.exportCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "transactions.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // toast handled by interceptor
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Reports</h1>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <Tabs defaultValue="spending">
        <TabsList>
          <TabsTrigger value="spending">Spending</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
        </TabsList>
        <TabsContent value="spending" className="mt-6"><SpendingTab /></TabsContent>
        <TabsContent value="trends" className="mt-6"><TrendsTab /></TabsContent>
        <TabsContent value="balances" className="mt-6"><BalanceHistoryTab /></TabsContent>
        <TabsContent value="imports" className="mt-6"><ImportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReportsPage() {
  return <AuthGuard><ReportsContent /></AuthGuard>;
}
