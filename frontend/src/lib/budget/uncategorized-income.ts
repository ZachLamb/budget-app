/**
 * Income that the budget month cannot see.
 *
 * Budget groups income by category, so a deposit with no category counts
 * as zero. The Dashboard's pay-cycle card reads the same transactions
 * without grouping, so the two pages sat side by side saying "Income
 * $5,000.00" and "Income $0.00" about the same paycheck, with nothing
 * anywhere to reconcile them.
 *
 * Reporting the amount is the point -- a count of uncategorized rows does
 * not tell you whether the gap is a paycheck or a coffee.
 */

export interface UncategorizedPage {
  transactions: { amount: number }[];
  /** Total matching rows, which may exceed the page that was fetched. */
  total: number;
}

export interface UncategorizedIncome {
  amount: number;
  /** The page did not hold every match, so the real figure is higher. */
  partial: boolean;
}

export function uncategorizedIncome(page: UncategorizedPage | undefined): UncategorizedIncome | null {
  if (!page) return null;
  const amount = page.transactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  if (amount <= 0) return null;
  return { amount, partial: page.total > page.transactions.length };
}
