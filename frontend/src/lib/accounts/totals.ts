/**
 * Totals for the accounts page.
 *
 * The page that exists to show balances made you add them up yourself:
 * a group header, then a list, and no subtotal anywhere. The Dashboard
 * had net worth all along, which meant the two pages showed the same
 * money at different levels of usefulness.
 */

export const DEBT_ACCOUNT_TYPES = ["credit", "loan"];

export type BalanceLike = { account_type: string; balance: number | string };

export function isDebt(accountType: string): boolean {
  return DEBT_ACCOUNT_TYPES.includes(accountType);
}

/**
 * Sum of a group's balances, in the sign the balances are stored in.
 *
 * Debt groups are reported as a positive amount owed, matching how each
 * row already renders, so a "Credit Card" subtotal does not contradict
 * the rows above it.
 */
export function groupTotal(accounts: BalanceLike[]): number {
  return accounts.reduce((sum, a) => sum + Number(a.balance), 0);
}

export type NetWorth = {
  assets: number;
  /** Positive: what is owed. */
  debts: number;
  net: number;
};

export function netWorth(accounts: BalanceLike[]): NetWorth {
  let assets = 0;
  let debts = 0;
  for (const a of accounts) {
    const n = Number(a.balance);
    if (!Number.isFinite(n)) continue;
    if (isDebt(a.account_type)) debts += Math.abs(n);
    else assets += n;
  }
  return { assets, debts, net: assets - debts };
}
