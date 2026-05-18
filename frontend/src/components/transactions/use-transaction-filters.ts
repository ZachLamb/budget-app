"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TransactionFilters } from "@/lib/api/transactions";
import {
  parseTransactionFiltersFromSearchParams,
  transactionFiltersToSearchParams,
} from "@/lib/transaction-filters-url";

export function useTransactionFilters() {
  const [filters, setFilters] = useState<TransactionFilters>({ page: 1, page_size: 50 });
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlSyncedRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (urlSyncedRef.current) return;
    urlSyncedRef.current = true;
    const parsed = parseTransactionFiltersFromSearchParams(searchParams);
    queueMicrotask(() => setFilters(parsed));
  }, [searchParams]);

  const pushFiltersToUrl = (next: TransactionFilters) => {
    const qs = transactionFiltersToSearchParams(next).toString();
    router.replace(qs ? `/transactions?${qs}` : "/transactions", { scroll: false });
  };

  const updateFilters = (
    patch: Partial<TransactionFilters> | ((f: TransactionFilters) => TransactionFilters),
  ) => {
    setFilters((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      const delay = "search" in (typeof patch === "object" ? patch : {}) ? 400 : 0;
      if (delay) {
        searchDebounceRef.current = setTimeout(() => pushFiltersToUrl(next), delay);
      } else {
        pushFiltersToUrl(next);
      }
      return next;
    });
  };

  return { filters, setFilters, updateFilters };
}
