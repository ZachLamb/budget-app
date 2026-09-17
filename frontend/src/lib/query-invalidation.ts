/**
 * One definition of "what goes stale when transaction data changes".
 *
 * Two call sites needed this and had drifted apart:
 *
 *  - the Transactions page invalidated only ["transactions"] and ["accounts"]
 *    after every add / edit / delete / categorize / split, so the Dashboard's
 *    budget figures and spending charts kept showing pre-edit numbers;
 *  - the sync-completion effect in navigation.tsx invalidated ["reports"], but
 *    the Dashboard's charts live under ["spending-by-category"],
 *    ["spending-by-month"] and ["cycle-summary"], which are NOT under that
 *    prefix — so a bank sync could import transactions and leave the charts
 *    unchanged.
 *
 * Both are hidden by the 30s global staleTime: navigate back inside that window
 * and the cache is still "fresh", so nothing refetches and the numbers are
 * simply wrong. After 30s it self-corrects, which reads as flakiness rather
 * than a bug — the reason this went unnoticed.
 *
 * Cost note: invalidateQueries only refetches *active* (mounted) queries;
 * unmounted ones are just marked stale and refetch when next rendered. So a
 * broad list here is cheap — from the Transactions page nothing on the
 * Dashboard is mounted, so this issues no extra requests, it only guarantees
 * fresh data on arrival.
 */
import type { QueryClient } from "@tanstack/react-query";

/**
 * Query-key prefixes holding data derived from transactions or balances.
 * Prefixes, so ["budget"] also covers ["budget", "2026-09"].
 *
 * Deliberately excluded: ["recurring"] is a user-maintained list rather than
 * derived data, and ["recurring-suggestions"] is an expensive 90-day heuristic
 * that a single transaction will not meaningfully change.
 */
export const TRANSACTION_DERIVED_KEYS: readonly (readonly string[])[] = [
  ["transactions"],
  ["accounts"],
  ["debtAccounts"],
  ["budget"],
  ["reports"],
  ["spending-by-category"],
  ["spending-by-month"],
  ["cycle-summary"],
  ["cycle-commitments"],
  ["payees"],
  ["goals"],
];

/** Mark everything derived from transaction data stale. */
export function invalidateTransactionDerived(queryClient: QueryClient): void {
  for (const key of TRANSACTION_DERIVED_KEYS) {
    queryClient.invalidateQueries({ queryKey: [...key] });
  }
}
