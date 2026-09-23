/**
 * Which filters are narrowing the transaction list right now.
 *
 * Two of them have no visible control: `uncategorized`, which the
 * dashboard's "Categorize" links turn on, and `payee_id`, which the
 * payees list hands over. Landing on either produced a short list with
 * nothing on screen to explain why, and no way back to the full one.
 */
import type { TransactionFilters } from "@/lib/api/transactions";

export type FilterChip = {
  /** The filter key this chip clears. */
  key: keyof TransactionFilters;
  label: string;
};

export function activeFilterChips(
  filters: TransactionFilters,
  names: { payeeName?: string | null; accountName?: string | null; categoryName?: string | null } = {},
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.uncategorized) chips.push({ key: "uncategorized", label: "Uncategorized only" });
  if (filters.payee_id) {
    chips.push({ key: "payee_id", label: `Payee: ${names.payeeName || "selected payee"}` });
  }
  if (filters.account_id && names.accountName) {
    chips.push({ key: "account_id", label: `Account: ${names.accountName}` });
  }
  if (filters.category_id && names.categoryName) {
    chips.push({ key: "category_id", label: `Category: ${names.categoryName}` });
  }
  if (filters.search?.trim()) chips.push({ key: "search", label: `Search: ${filters.search.trim()}` });
  if (filters.date_from) chips.push({ key: "date_from", label: `From ${filters.date_from}` });
  if (filters.date_to) chips.push({ key: "date_to", label: `To ${filters.date_to}` });
  return chips;
}

/**
 * A patch that turns every filter off.
 *
 * Each key is named explicitly rather than replacing the object, because
 * the patch is merged over the current filters -- anything left out would
 * survive the "Clear all" it is supposed to undo.
 */
export function clearFiltersPatch(): Partial<TransactionFilters> {
  return {
    search: undefined,
    account_id: undefined,
    category_id: undefined,
    payee_id: undefined,
    date_from: undefined,
    date_to: undefined,
    uncategorized: false,
    page: 1,
  };
}
