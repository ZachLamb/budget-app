"use client";

import type { Transaction } from "@/lib/api/transactions";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckCircle, Circle } from "lucide-react";

export function TransactionCardList({
  transactions,
  onSelect,
  onToggleCleared,
  isDemo,
}: {
  transactions: Transaction[];
  onSelect: (txn: Transaction) => void;
  onToggleCleared: (id: string, cleared: boolean) => void;
  isDemo: boolean;
}) {
  return (
    <ul className="md:hidden divide-y" role="list" data-testid="transaction-card-list">
      {transactions.map((txn) => (
        <li key={txn.id} role="listitem">
          <div className="flex gap-3 py-3">
            <button
              type="button"
              className="shrink-0 pt-0.5"
              aria-label={txn.cleared ? "Mark uncleared" : "Mark cleared"}
              disabled={isDemo}
              onClick={() => onToggleCleared(txn.id, !txn.cleared)}
            >
              {txn.cleared ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
            <button
              type="button"
              className="flex-1 min-w-0 text-left"
              onClick={() => onSelect(txn)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{txn.payee_name || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(txn.date).toLocaleDateString()}
                    {txn.category_name ? ` · ${txn.category_name}` : " · Uncategorized"}
                  </p>
                </div>
                <p
                  className={cn(
                    "shrink-0 font-mono text-sm font-semibold tabular-nums",
                    txn.amount >= 0 ? "text-green-600" : "text-red-600",
                  )}
                >
                  {formatCurrency(txn.amount)}
                </p>
              </div>
              {(txn.transfer_pair_id || txn.is_split) && (
                <div className="flex gap-1 mt-1">
                  {txn.transfer_pair_id && <Badge variant="outline" className="text-xs">Transfer</Badge>}
                  {txn.is_split && <Badge variant="outline" className="text-xs">Split</Badge>}
                </div>
              )}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
