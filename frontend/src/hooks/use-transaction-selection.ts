"use client";

import { useCallback, useMemo, useState } from "react";
import {
  transactionsApi,
  BULK_MAX,
  type TransactionFilters,
} from "@/lib/api/transactions";

/** The read endpoint's own cap. Paging it is how "select all matching"
 *  gets its ids without a second implementation of the filters -- the
 *  place a bulk write is most likely to go wrong is a filter clause that
 *  drifted from the one the list uses. */
const PAGE_SIZE = 200;

export interface TransactionSelection {
  selected: Set<string>;
  count: number;
  /** Click a row. Shift-click extends from the last click, like a file list. */
  toggle: (id: string, index: number, shiftKey: boolean) => void;
  isSelected: (id: string) => boolean;
  /** Header checkbox: every row on this page. */
  setPage: (ids: string[], on: boolean) => void;
  /** All rows matching the current filters, up to the bulk cap. */
  selectAllMatching: (
    filters: TransactionFilters,
    total: number,
  ) => Promise<{ selected: number; capped: boolean }>;
  clear: () => void;
  loadingAll: boolean;
}

export function useTransactionSelection(pageIds: string[]): TransactionSelection {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const toggle = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        // A shift-click with no prior click has no range to extend, so it
        // behaves as a plain click rather than doing nothing.
        if (shiftKey && anchor !== null) {
          const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
          // The anchor's state is what the range takes, matching how a
          // file list behaves: shift-click extends the last action.
          const turningOn = prev.has(pageIds[anchor]);
          for (let i = lo; i <= hi; i++) {
            if (turningOn) next.add(pageIds[i]);
            else next.delete(pageIds[i]);
          }
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!shiftKey || anchor === null) setAnchor(index);
    },
    [anchor, pageIds],
  );

  const setPage = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setAnchor(null);
  }, []);

  const selectAllMatching = useCallback(
    async (filters: TransactionFilters, total: number) => {
      setLoadingAll(true);
      try {
        const wanted = Math.min(total, BULK_MAX);
        const ids: string[] = [];
        for (let page = 1; ids.length < wanted; page++) {
          const batch = await transactionsApi.list({
            ...filters,
            page,
            page_size: PAGE_SIZE,
          });
          if (batch.transactions.length === 0) break;
          for (const t of batch.transactions) {
            if (ids.length >= wanted) break;
            ids.push(t.id);
          }
        }
        // Replaces rather than adds: "select all matching" is a statement
        // about the filter, not an addition to whatever was ticked before.
        setSelected(new Set(ids));
        setAnchor(null);
        return { selected: ids.length, capped: total > BULK_MAX };
      } finally {
        setLoadingAll(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      toggle,
      isSelected,
      setPage,
      selectAllMatching,
      clear,
      loadingAll,
    }),
    [selected, toggle, isSelected, setPage, selectAllMatching, clear, loadingAll],
  );
}
