/**
 * Report series shaping.
 *
 * The API returns only the months that have activity. Charted straight,
 * a household that spent nothing in April and June draws Mar/May/Jul at
 * even spacing, so a gap in the data reads as a continuous trend. Filling
 * the gaps with real zeroes keeps the time axis linear.
 */

export type MonthlyPoint = { month: string; income: number; expenses: number; net: number };

export type BalancePoint = { date: string; balance: number };

function addMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? [y + 1, 1] : [y, m + 1];
  return `${next[0]}-${String(next[1]).padStart(2, "0")}`;
}

/** Sparse monthly data → one point per calendar month, oldest first. */
export function fillMonthGaps(points: MonthlyPoint[]): MonthlyPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(sorted.map((p) => [p.month, p]));

  const filled: MonthlyPoint[] = [];
  let cursor = sorted[0].month;
  const last = sorted[sorted.length - 1].month;
  // A malformed month string would otherwise spin here forever.
  for (let guard = 0; cursor <= last && guard < 600; guard++) {
    filled.push(byMonth.get(cursor) ?? { month: cursor, income: 0, expenses: 0, net: 0 });
    cursor = addMonth(cursor);
  }
  return filled;
}

export type BalanceSummary = {
  start: number;
  end: number;
  change: number;
  low: number;
  high: number;
  from: string;
  to: string;
};

/**
 * Start, end and swing of a balance series.
 *
 * A line chart shows the shape; it takes squinting at the axis to answer
 * "am I up or down over this period", which is the only question the
 * chart is really asked.
 */
export function summarizeBalances(points: BalancePoint[]): BalanceSummary | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const balances = sorted.map((p) => p.balance);
  const start = balances[0];
  const end = balances[balances.length - 1];
  return {
    start,
    end,
    change: end - start,
    low: Math.min(...balances),
    high: Math.max(...balances),
    from: sorted[0].date,
    to: sorted[sorted.length - 1].date,
  };
}
