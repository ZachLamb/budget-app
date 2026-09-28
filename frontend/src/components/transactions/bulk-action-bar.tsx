"use client";

import { useState } from "react";
import type { FlatCategory } from "@/lib/hooks";
import type { Transaction } from "@/lib/api/transactions";
import { BULK_MAX } from "@/lib/api/transactions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Check, Circle } from "lucide-react";

export interface BulkChange {
  category_id?: string;
  cleared?: boolean;
  clear_category?: boolean;
}

export interface BulkActionBarProps {
  count: number;
  /** Total rows matching the current filters, for the "select all" offer. */
  matchingTotal: number;
  allCategories: FlatCategory[];
  onApply: (change: BulkChange) => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
  isPending: boolean;
  loadingAll: boolean;
  disabled?: boolean;
}

/**
 * Appears only when rows are selected.
 *
 * Categorizing an import one dropdown at a time is the most tedious thing
 * in this app and the first thing a new household meets. This is the
 * shortcut. It is deliberately a small set of actions: the ones worth
 * doing to fifty rows at once.
 */
export function BulkActionBar({
  count,
  matchingTotal,
  allCategories,
  onApply,
  onSelectAllMatching,
  onClear,
  isPending,
  loadingAll,
  disabled,
}: BulkActionBarProps) {
  // Reset by key after each apply, so the dropdown does not sit there
  // showing a category that has already been applied.
  const [nonce, setNonce] = useState(0);

  if (count === 0) return null;

  const apply = (change: BulkChange) => {
    onApply(change);
    setNonce((n) => n + 1);
  };

  // Offer the wider selection only when there is one to make.
  const canSelectMore = matchingTotal > count;

  return (
    <div
      className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur"
      role="region"
      aria-label="Bulk actions"
    >
      <span className="text-sm font-medium" aria-live="polite">
        {count} selected
      </span>

      {canSelectMore && (
        <Button
          variant="link"
          size="sm"
          className="h-7 px-1 text-xs"
          onClick={onSelectAllMatching}
          disabled={loadingAll || disabled}
        >
          {loadingAll
            ? "Selecting…"
            : matchingTotal > BULK_MAX
              ? `Select ${BULK_MAX} of ${matchingTotal} matching`
              : `Select all ${matchingTotal} matching`}
        </Button>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select
          key={`cat-${nonce}`}
          onValueChange={(v) =>
            apply(v === "__clear__" ? { clear_category: true } : { category_id: v })
          }
          disabled={isPending || disabled}
        >
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Set category…" />
          </SelectTrigger>
          <SelectContent>
            {allCategories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.groupName} &gt; {c.name}
              </SelectItem>
            ))}
            <SelectItem value="__clear__">Clear category</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => apply({ cleared: true })}
          disabled={isPending || disabled}
        >
          <Check className="h-3 w-3" /> Mark cleared
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => apply({ cleared: false })}
          disabled={isPending || disabled}
        >
          <Circle className="h-3 w-3" /> Mark uncleared
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** What a bulk change replaced, so it can be put back.
 *
 *  Undo restores each row's own previous value rather than re-applying a
 *  single one: a bulk categorize over rows that were not all the same
 *  before cannot be undone by any one setting. */
export interface BulkUndo {
  label: string;
  before: { id: string; category_id: string | null; cleared: boolean }[];
}

export function snapshotFor(
  transactions: Transaction[],
  ids: Set<string>,
): BulkUndo["before"] | null {
  const rows = transactions.filter((t) => ids.has(t.id));
  // "Select all matching" can reach rows on other pages, which are not in
  // hand to snapshot. A partial snapshot would restore the visible rows
  // and quietly leave the rest changed -- worse than no undo at all, so
  // undo is withheld rather than made unreliable.
  if (rows.length !== ids.size) return null;
  return rows.map((t) => ({
    id: t.id,
    category_id: t.category_id ?? null,
    cleared: t.cleared,
  }));
}

/** Group a snapshot into the fewest bulk calls that restore it.
 *
 *  Rows that were not all alike before cannot be restored by one call, so
 *  the snapshot is bucketed by the value it is going back to: after an
 *  import that is usually a single bucket (uncategorized), never one call
 *  per row. */
export function undoBatches(
  before: BulkUndo["before"],
): { ids: string[]; category_id?: string; clear_category?: boolean; cleared: boolean }[] {
  const buckets = new Map<string, BulkUndo["before"]>();
  for (const row of before) {
    const key = `${row.category_id ?? ""}|${row.cleared}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  return [...buckets.values()].map((rows) => ({
    ids: rows.map((r) => r.id),
    ...(rows[0].category_id
      ? { category_id: rows[0].category_id }
      : { clear_category: true }),
    cleared: rows[0].cleared,
  }));
}
