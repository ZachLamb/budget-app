"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account } from "@/lib/api/accounts";
import {
  reconciliationApi,
  type ReconcileSuggestion,
  type ReconcileTxnRef,
} from "@/lib/api/accounts";
import { transactionsApi } from "@/lib/api/transactions";
import { invalidateTransactionDerived } from "@/lib/query-invalidation";
import { useFlatCategories } from "@/lib/hooks";
import { formatCurrency, formatDate } from "@/lib/format";
import { appToast } from "@/lib/app-toast";
import { toastApiError, getApiErrorMessage } from "@/lib/toast-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Lightbulb } from "lucide-react";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function TxnLine({ t }: { t: ReconcileTxnRef }) {
  return (
    <span className="tabular-nums">
      {formatDate(t.date, { month: "short", day: "numeric" })} ·{" "}
      {t.payee_name || "—"} · {formatCurrency(Number(t.amount))}
    </span>
  );
}

/** One lead, with the button that acts on it.
 *
 *  A suggestion you have to go and carry out by hand somewhere else is
 *  only half an answer, so the fix is offered where the finding is. */
function SuggestionCard({
  s,
  onAct,
  busy,
}: {
  s: ReconcileSuggestion;
  onAct: (ids: string[], cleared: boolean) => void;
  busy: boolean;
}) {
  const ids = s.transactions.map((t) => t.transaction_id);
  const action =
    s.kind === "clear_one" || s.kind === "clear_pair"
      ? { label: ids.length > 1 ? "Clear both" : "Clear it", cleared: true }
      : s.kind === "unclear_one"
        ? { label: "Mark uncleared", cleared: false }
        : null;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 space-y-2">
          <p>{s.explanation}</p>
          {s.transactions.length > 0 && (
            <ul className="space-y-0.5 text-muted-foreground">
              {s.transactions.map((t) => (
                <li key={t.transaction_id}>
                  <TxnLine t={t} />
                </li>
              ))}
            </ul>
          )}
          {action && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => onAct(ids, action.cleared)}
            >
              {action.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReconcileDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { allCategories } = useFlatCategories();
  const [statementDate, setStatementDate] = useState(today);
  const [statementBalance, setStatementBalance] = useState("");
  const [adjustmentCategory, setAdjustmentCategory] = useState("");

  // Only asked once there is a figure to compare against. Without a
  // statement balance there is no question to answer, and defaulting one
  // would produce a difference that means nothing.
  const canCompare =
    !!account &&
    statementBalance.trim() !== "" &&
    !Number.isNaN(Number(statementBalance));

  const view = useQuery({
    queryKey: ["reconciliation", account?.id, statementDate, statementBalance],
    queryFn: () =>
      reconciliationApi.view(account!.id, statementDate, statementBalance),
    enabled: open && canCompare,
  });

  const history = useQuery({
    queryKey: ["reconciliations", account?.id],
    queryFn: () => reconciliationApi.history(account!.id),
    enabled: open && !!account,
  });

  const difference = view.data ? Number(view.data.difference) : null;
  const balanced = difference !== null && Math.abs(difference) < 0.005;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["reconciliation", account?.id] });
    invalidateTransactionDerived(queryClient);
  };

  const clearMutation = useMutation({
    mutationFn: ({ ids, cleared }: { ids: string[]; cleared: boolean }) =>
      transactionsApi.bulkUpdate({ transaction_ids: ids, cleared }),
    onSuccess: refresh,
    onError: (e) => toastApiError("Could not update those transactions", e),
  });

  const signOff = useMutation({
    mutationFn: (opts: {
      create_adjustment?: boolean;
      allow_difference?: boolean;
    }) =>
      reconciliationApi.reconcile(account!.id, {
        statement_date: statementDate,
        statement_balance: statementBalance,
        adjustment_category_id: adjustmentCategory || undefined,
        ...opts,
      }),
    onSuccess: (rec) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["reconciliations", account?.id] });
      appToast.success(
        `Reconciled ${rec.transaction_count} transaction${rec.transaction_count === 1 ? "" : "s"} to ${statementDate}`,
      );
      onOpenChange(false);
    },
    onError: (e) => toastApiError("Could not reconcile", e),
  });

  const lastReconciled =
    view.data?.last_reconciled_on ?? history.data?.[0]?.statement_date ?? null;
  const uncleared = view.data?.uncleared ?? [];
  const busy = clearMutation.isPending || signOff.isPending;
  const suggestions = useMemo(() => view.data?.suggestions ?? [], [view.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reconcile {account?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lastReconciled ? (
              <>
                Last balanced against a statement dated{" "}
                <strong>{formatDate(lastReconciled)}</strong>.
              </>
            ) : (
              // Said plainly rather than shown as a blank: never having
              // reconciled is a fact about the account, not missing data.
              <>This account has never been reconciled.</>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stmt-date">Statement date</Label>
              <Input
                id="stmt-date"
                type="date"
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stmt-balance">Ending balance</Label>
              <Input
                id="stmt-balance"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
              />
            </div>
          </div>

          {!canCompare ? (
            <p className="text-sm text-muted-foreground">
              Enter the closing balance from your statement to compare.
            </p>
          ) : view.isError ? (
            <p className="text-sm text-destructive">
              {getApiErrorMessage(view.error, "Could not compare this account.")}
            </p>
          ) : !view.data ? (
            <p className="text-sm text-muted-foreground">Comparing…</p>
          ) : (
            <>
              <dl className="space-y-1 rounded-md border p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Statement says</dt>
                  <dd className="tabular-nums">
                    {formatCurrency(Number(view.data.statement_balance))}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Cleared here ({view.data.cleared_count})
                  </dt>
                  <dd className="tabular-nums">
                    {formatCurrency(Number(view.data.cleared_balance))}
                  </dd>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium">
                  <dt>Difference</dt>
                  <dd
                    className={
                      balanced
                        ? "tabular-nums text-green-600"
                        : "tabular-nums text-destructive"
                    }
                  >
                    {formatCurrency(difference ?? 0)}
                  </dd>
                </div>
              </dl>

              {balanced ? (
                <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  This account agrees with your statement.
                </p>
              ) : (
                <>
                  {suggestions.length > 0 ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">What might explain it</h3>
                      {suggestions.map((s, i) => (
                        <SuggestionCard
                          key={`${s.kind}-${i}`}
                          s={s}
                          busy={busy}
                          onAct={(ids, cleared) =>
                            clearMutation.mutate({ ids, cleared })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    // Silence beats a fabricated lead: nothing in the
                    // ledger adds up to this gap.
                    <p className="text-sm text-muted-foreground">
                      Nothing here adds up to the difference. Check the uncleared
                      transactions below against your statement, or look for one
                      that is missing entirely.
                    </p>
                  )}

                  {uncleared.length > 0 && (
                    <details className="rounded-md border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">
                        {uncleared.length} not yet cleared
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {uncleared.map((t) => (
                          <li
                            key={t.transaction_id}
                            className="flex items-center justify-between gap-2"
                          >
                            <TxnLine t={t} />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 shrink-0 text-xs"
                              disabled={busy}
                              onClick={() =>
                                clearMutation.mutate({
                                  ids: [t.transaction_id],
                                  cleared: true,
                                })
                              }
                            >
                              Clear
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <div className="space-y-2 rounded-md border border-dashed p-3">
                    <p className="text-sm font-medium">
                      Or close the gap with a balancing entry
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Adds a real transaction for {formatCurrency(difference ?? 0)}{" "}
                      so the account matches. Reasonable for an old account nobody
                      will reconstruct — but it is a made-up figure, and the record
                      will say so.
                    </p>
                    <Select
                      value={adjustmentCategory}
                      onValueChange={setAdjustmentCategory}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Category for the entry…" />
                      </SelectTrigger>
                      <SelectContent>
                        {allCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.groupName} &gt; {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      disabled={busy || !adjustmentCategory}
                      onClick={() => signOff.mutate({ create_adjustment: true })}
                    >
                      Add balancing entry and reconcile
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 border-t pt-3">
            {view.data && view.data.reconciled_count > 0 && (
              <Badge variant="secondary" className="mr-auto text-xs">
                {view.data.reconciled_count} already locked
              </Badge>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              disabled={!balanced || busy}
              title={
                balanced
                  ? undefined
                  : "Balance the account first, or add a balancing entry"
              }
              onClick={() => signOff.mutate({})}
            >
              {signOff.isPending ? "Reconciling…" : "Reconcile"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
