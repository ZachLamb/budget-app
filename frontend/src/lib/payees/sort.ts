/**
 * Ordering for the payees list.
 *
 * Alphabetical is the right default for finding a name you already have
 * in mind. It is the wrong one for the question the page is actually
 * useful for -- "where is the money going" -- so the same list can be
 * turned around by spend, frequency or recency.
 */
import type { PayeeActivity } from "@/lib/api/payees";

export const PAYEE_SORTS = ["name", "spent", "count", "recent"] as const;
export type PayeeSort = (typeof PAYEE_SORTS)[number];

export const PAYEE_SORT_LABELS: Record<PayeeSort, string> = {
  name: "Name (A–Z)",
  spent: "Most spent",
  count: "Most transactions",
  recent: "Recently used",
};

export type PayeeRow = {
  id: string;
  name: string;
  transaction_count: number;
  /** Signed: negative is money out. */
  total_amount: number;
  last_date: string | null;
  top_category_id: string | null;
  top_category_name: string | null;
};

/** One row per payee, with zeroes where a payee has no activity yet. */
export function mergeActivity(
  payees: { id: string; name: string }[],
  activity: PayeeActivity[],
): PayeeRow[] {
  const byId = new Map(activity.map((a) => [a.payee_id, a]));
  return payees.map((p) => {
    const a = byId.get(p.id);
    return {
      id: p.id,
      name: p.name,
      transaction_count: a?.transaction_count ?? 0,
      total_amount: a ? Number(a.total_amount) : 0,
      last_date: a?.last_date ?? null,
      top_category_id: a?.top_category_id ?? null,
      top_category_name: a?.top_category_name ?? null,
    };
  });
}

function byName(a: PayeeRow, b: PayeeRow) {
  return a.name.localeCompare(b.name);
}

export function sortPayees(rows: PayeeRow[], sort: PayeeSort): PayeeRow[] {
  const out = [...rows];
  switch (sort) {
    case "spent":
      // Money out is negative, so the biggest outflow is the most negative.
      return out.sort((a, b) => a.total_amount - b.total_amount || byName(a, b));
    case "count":
      return out.sort((a, b) => b.transaction_count - a.transaction_count || byName(a, b));
    case "recent":
      // Never-used payees sort last rather than jumbling in among the dates.
      return out.sort((a, b) => {
        if (a.last_date === b.last_date) return byName(a, b);
        if (a.last_date === null) return 1;
        if (b.last_date === null) return -1;
        return b.last_date.localeCompare(a.last_date);
      });
    default:
      return out.sort(byName);
  }
}
