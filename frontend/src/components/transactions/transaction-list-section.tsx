"use client";

import type { UseMutationResult } from "@tanstack/react-query";
import type { Account } from "@/lib/api/accounts";
import type { Transaction, TransactionFilters, TransactionList } from "@/lib/api/transactions";
import type { LlmSuggestion } from "@/lib/api/reports";
import type { FlatCategory } from "@/lib/hooks";
import { TransactionCardList } from "@/components/transactions/transaction-card-list";
import { QueryState } from "@/components/page";
import { SkeletonTable } from "@/components/skeleton-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Circle,
  MoreHorizontal,
  Pencil,
  SplitSquareHorizontal,
  Trash2,
} from "lucide-react";

export interface TransactionListSectionProps {
  filters: TransactionFilters;
  txnData: TransactionList | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  accounts: Account[];
  allCategories: FlatCategory[];
  toggleCleared: UseMutationResult<unknown, unknown, { id: string; cleared: boolean }, unknown>;
  inlineCategoryMutation: UseMutationResult<
    unknown,
    unknown,
    { id: string; category_id: string | null },
    unknown
  >;
  categorySuggestionByTxnId: Map<string, LlmSuggestion>;
  isDemo: boolean;
  totalPages: number;
  updateFilters: (
    patch: Partial<TransactionFilters> | ((f: TransactionFilters) => TransactionFilters),
  ) => void;
  clampPage: (page: number, totalPages: number) => number;
  setDetailTxn: (txn: Transaction | null) => void;
  startEdit: (txn: Transaction) => void;
  startSplit: (txn: Transaction) => void;
  setDeleteId: (id: string | null) => void;
}

export function TransactionListSection({
  filters,
  txnData,
  isLoading,
  isError,
  error,
  refetch,
  allCategories,
  toggleCleared,
  inlineCategoryMutation,
  categorySuggestionByTxnId,
  isDemo,
  totalPages,
  updateFilters,
  clampPage,
  setDetailTxn,
  startEdit,
  startSplit,
  setDeleteId,
}: TransactionListSectionProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <QueryState
          isLoading={isLoading && !txnData}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          isEmpty={!!txnData && txnData.total === 0}
          emptyDescription="No transactions match your filters."
          loadingFallback={<SkeletonTable rows={8} columns={6} />}
        >
          {txnData && txnData.transactions.length > 0 && (
            <TransactionCardList
              transactions={txnData.transactions}
              onSelect={setDetailTxn}
              onToggleCleared={(id, cleared) => toggleCleared.mutate({ id, cleared })}
              isDemo={isDemo}
            />
          )}
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Date</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {txnData?.transactions.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleCleared.mutate({ id: txn.id, cleared: !txn.cleared })}
                      title={txn.cleared ? "Cleared" : "Uncleared"}
                    >
                      {txn.cleared ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(txn.date).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setDetailTxn(txn)}
                      className="font-medium hover:underline text-left"
                    >
                      {txn.payee_name || "—"}
                      {txn.transfer_pair_id && (
                        <Badge variant="outline" className="ml-1 text-xs">
                          Transfer
                        </Badge>
                      )}
                      {txn.is_split && (
                        <Badge variant="outline" className="ml-1 text-xs">
                          Split
                        </Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="align-top max-w-[min(18rem,40vw)]">
                    {!txn.is_split && !txn.transfer_pair_id ? (
                      <div className="flex flex-col gap-1.5 py-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Select
                            value={txn.category_id || "uncategorized"}
                            onValueChange={(v) => {
                              const cid = v === "uncategorized" ? null : v;
                              inlineCategoryMutation.mutate({ id: txn.id, category_id: cid });
                            }}
                            disabled={isDemo || inlineCategoryMutation.isPending}
                          >
                            <SelectTrigger className="h-8 w-full min-w-40 max-w-56 text-xs">
                              <SelectValue placeholder="Uncategorized" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="uncategorized">Uncategorized</SelectItem>
                              {allCategories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.groupName} &gt; {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {categorySuggestionByTxnId.has(txn.id) && !isDemo ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-[10px] font-normal"
                              title="Apply AI-suggested category"
                              disabled={inlineCategoryMutation.isPending}
                              onClick={() => {
                                const sug = categorySuggestionByTxnId.get(txn.id)!;
                                inlineCategoryMutation.mutate({
                                  id: txn.id,
                                  category_id: sug.suggested_category_id,
                                });
                              }}
                            >
                              AI: {categorySuggestionByTxnId.get(txn.id)!.category_name}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : txn.category_name ? (
                      <Badge variant="secondary">{txn.category_name}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Uncategorized</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-32 truncate">
                    {txn.notes || ""}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono",
                      Number(txn.amount) >= 0 ? "text-green-600" : "text-red-600",
                    )}
                  >
                    {formatCurrency(Number(txn.amount))}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => startEdit(txn)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        {!txn.is_split && !txn.transfer_pair_id && (
                          <DropdownMenuItem onClick={() => startSplit(txn)}>
                            <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2" /> Split
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteId(txn.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {txnData && txnData.total > 0 && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {((filters.page || 1) - 1) * (filters.page_size || 50) + 1}–
                {Math.min((filters.page || 1) * (filters.page_size || 50), txnData.total)} of{" "}
                {txnData.total}
              </p>
              {totalPages > 1 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(filters.page || 1) <= 1}
                    onClick={() => updateFilters({ page: (filters.page || 1) - 1 })}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="flex items-center text-sm">
                    Page {filters.page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(filters.page || 1) >= totalPages}
                    onClick={() =>
                      updateFilters({ page: clampPage((filters.page || 1) + 1, totalPages) })
                    }
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
