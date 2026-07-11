"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "categories_collapsed_groups";

function readStored(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Stores which groups are COLLAPSED (not expanded): groups are expanded by
 * default, so newly created groups start open and data refetches can never
 * clobber the user's state.
 */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Storage unavailable (private mode/quota); in-memory state still works.
    }
  }, [collapsed]);

  const isExpanded = useCallback((id: string) => !collapsed.has(id), [collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback((ids: string[]) => setCollapsed(new Set(ids)), []);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  return { isExpanded, toggle, collapseAll, expandAll };
}
