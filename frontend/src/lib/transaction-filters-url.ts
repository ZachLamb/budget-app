import type { TransactionFilters } from "@/lib/api/transactions";

export type TransactionUrlParams = {
  page?: string;
  page_size?: string;
  search?: string;
  account_id?: string;
  category_id?: string;
  date_from?: string;
  date_to?: string;
  uncategorized?: string;
};

const DEFAULT_PAGE_SIZE = 50;

export function parseTransactionFiltersFromSearchParams(
  params: URLSearchParams,
): TransactionFilters {
  const pageRaw = params.get("page");
  const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1;
  const pageSizeRaw = params.get("page_size");
  const page_size = pageSizeRaw
    ? Math.min(200, Math.max(1, parseInt(pageSizeRaw, 10) || DEFAULT_PAGE_SIZE))
    : DEFAULT_PAGE_SIZE;

  const uncategorizedRaw = params.get("uncategorized");
  const uncategorized =
    uncategorizedRaw === "1" || uncategorizedRaw === "true" ? true : undefined;

  const filters: TransactionFilters = {
    page,
    page_size,
  };

  const search = params.get("search")?.trim();
  if (search) filters.search = search;

  const account_id = params.get("account_id")?.trim();
  if (account_id && account_id !== "all") filters.account_id = account_id;

  const category_id = params.get("category_id")?.trim();
  if (category_id && category_id !== "all") filters.category_id = category_id;

  const date_from = params.get("date_from")?.trim();
  if (date_from) filters.date_from = date_from;

  const date_to = params.get("date_to")?.trim();
  if (date_to) filters.date_to = date_to;

  if (uncategorized) filters.uncategorized = true;

  return filters;
}

export function transactionFiltersToSearchParams(
  filters: TransactionFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  const page = filters.page ?? 1;
  const page_size = filters.page_size ?? DEFAULT_PAGE_SIZE;

  if (page > 1) params.set("page", String(page));
  if (page_size !== DEFAULT_PAGE_SIZE) params.set("page_size", String(page_size));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.account_id) params.set("account_id", filters.account_id);
  if (filters.category_id) params.set("category_id", filters.category_id);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  if (filters.uncategorized) params.set("uncategorized", "1");

  return params;
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  return Math.min(Math.max(1, page), totalPages);
}

/** Read URL once on mount; write URL when filters change (caller debounces search). */
export function filtersDifferForUrl(a: TransactionFilters, b: TransactionFilters): boolean {
  return transactionFiltersToSearchParams(a).toString() !== transactionFiltersToSearchParams(b).toString();
}
