"use client";

import type { UseMutationResult } from "@tanstack/react-query";
import type { FsaEligibleTransaction, FsaReviewResponse } from "@/lib/api/ai";
import { AI_COPY } from "@/lib/ai-copy";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Stethoscope,
  Undo2,
  X,
} from "lucide-react";

export type FsaConfFilter = "all" | "high" | "medium" | "low";
export type FsaSortCol = "date" | "amount" | "confidence";

export interface FsaReviewPanelProps {
  fsaOpen: boolean;
  setFsaOpen: (open: boolean) => void;
  fsaDateFrom: string;
  setFsaDateFrom: (value: string) => void;
  fsaDateTo: string;
  setFsaDateTo: (value: string) => void;
  fsaIncludeAllOutflows: boolean;
  setFsaIncludeAllOutflows: (value: boolean) => void;
  fsaConfFilter: FsaConfFilter;
  setFsaConfFilter: (value: FsaConfFilter) => void;
  fsaShowDismissed: boolean;
  setFsaShowDismissed: (value: boolean) => void;
  fsaSortCol: FsaSortCol;
  fsaSortDir: "asc" | "desc";
  toggleFsaSort: (col: FsaSortCol) => void;
  fsaData: FsaReviewResponse | undefined;
  fsaLoading: boolean;
  fsaFetching: boolean;
  fsaError: boolean;
  fsaRefetch: () => void;
  filteredFsa: FsaEligibleTransaction[];
  handleFsaExportCsv: () => void;
  fsaStatusMutation: UseMutationResult<
    { status: string },
    unknown,
    { txnId: string; status: "pending" | "claimed" | "dismissed" },
    unknown
  >;
  isDemo: boolean;
}

export function FsaReviewPanel({
  fsaOpen,
  setFsaOpen,
  fsaDateFrom,
  setFsaDateFrom,
  fsaDateTo,
  setFsaDateTo,
  fsaIncludeAllOutflows,
  setFsaIncludeAllOutflows,
  fsaConfFilter,
  setFsaConfFilter,
  fsaShowDismissed,
  setFsaShowDismissed,
  fsaSortCol,
  fsaSortDir,
  toggleFsaSort,
  fsaData,
  fsaLoading,
  fsaFetching,
  fsaError,
  fsaRefetch,
  filteredFsa,
  handleFsaExportCsv,
  fsaStatusMutation,
  isDemo,
}: FsaReviewPanelProps) {
  return (
    <Card>
      <CardHeader>
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setFsaOpen(!fsaOpen)}
        >
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-purple-500" />
            <span className="font-semibold">FSA Reimbursement Review</span>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", fsaOpen && "rotate-180")} />
        </button>
      </CardHeader>
      {fsaOpen && (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            When this section is open, we scan recent outflows for health-related payees (or all outflows if you choose below).
            Adjust dates and click Scan again to refresh.
          </p>
          <p className="text-xs text-muted-foreground">
            Results assume a standard Healthcare FSA (HCFSA). Rules differ for
            Limited-Purpose FSA (dental/vision only), Dependent-Care FSA
            (childcare), and HSA. Always verify eligible items with your plan
            administrator (IRS Pub 502) before filing a claim.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" className="w-40" value={fsaDateFrom} onChange={(e) => setFsaDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" className="w-40" value={fsaDateTo} onChange={(e) => setFsaDateTo(e.target.value)} />
            </div>
            <label className="flex max-w-xs cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={fsaIncludeAllOutflows}
                onChange={(e) => setFsaIncludeAllOutflows(e.target.checked)}
              />
              Scan all outflows (slower; skips keyword pre-filter)
            </label>
            <Button
              size="sm"
              onClick={() => fsaRefetch()}
              disabled={fsaFetching}
            >
              {fsaFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Stethoscope className="mr-2 h-4 w-4" />}
              Scan now
            </Button>
          </div>

          {(fsaLoading || fsaFetching) && !fsaData ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Running FSA scan…
            </p>
          ) : null}

          {fsaError && (
            <p className="text-sm text-destructive">
              Failed to scan transactions. Check that AI is enabled in Settings and your LLM is reachable.
            </p>
          )}

          {fsaData && !fsaFetching && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
                <p className="text-sm">
                  {fsaConfFilter !== "all" ? (
                    <>Showing <span className="font-semibold">{filteredFsa.length}</span> of{" "}</>
                  ) : null}
                  <span className="font-semibold">{fsaData.eligible_transactions.length}</span> potentially eligible
                  {fsaData.eligible_transactions.length === 1 ? " transaction" : " transactions"} totaling{" "}
                  <span className="font-semibold font-mono">{formatCurrency(fsaData.total_potential_amount)}</span>
                  {" "}across {fsaData.scan_count} scanned
                  {(fsaData.candidate_count ?? 0) > 0 ? (
                    <> ({fsaData.candidate_count} sent to AI)</>
                  ) : null}
                  .
                  {fsaData.parse_errors > 0 && (
                    <span className="text-yellow-600 ml-2">({fsaData.parse_errors} batch{fsaData.parse_errors > 1 ? "es" : ""} failed to parse — try again or check the model output.)</span>
                  )}
                  {(fsaData.llm_batch_failures ?? 0) > 0 && (
                    <span className="text-destructive ml-2">
                      ({fsaData.llm_batch_failures} AI batch{fsaData.llm_batch_failures > 1 ? "es" : ""} returned no response — is Ollama running?)
                    </span>
                  )}
                </p>
                {fsaData.eligible_transactions.length > 0 && (
                  <Button size="sm" variant="outline" onClick={handleFsaExportCsv}>
                    <Download className="mr-2 h-4 w-4" />Export CSV
                  </Button>
                )}
              </div>

              {fsaData.eligible_transactions.length === 0 &&
                (fsaData.scan_count ?? 0) > 0 &&
                (fsaData.llm_batch_failures ?? 0) === 0 &&
                (fsaData.parse_errors ?? 0) === 0 &&
                (fsaData.candidate_count ?? 0) === 0 &&
                (fsaData.prefilter_skipped_count ?? 0) > 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                  No transactions matched the health-keyword pre-filter. Try widening the date range, enable &quot;Scan all outflows&quot; for a
                  broader (slower) pass, or ensure medical payees/notes contain common terms (pharmacy, dental, copay, etc.).
                </p>
              ) : null}

              {fsaData.eligible_transactions.length === 0 &&
                (fsaData.candidate_count ?? 0) > 0 &&
                (fsaData.llm_batch_failures ?? 0) > 0 &&
                (fsaData.parse_errors ?? 0) === 0 ? (
                <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  The AI did not return results for this scan. Enable Ollama in Settings or retry. If the problem persists, check server logs.
                </p>
              ) : null}

              {fsaData.eligible_transactions.length > 0 && (
                <>
                  {isDemo ? (
                    <p className="text-xs text-muted-foreground mb-2">
                      Demo is read-only — you can scan and export, but marking claimed or dismissed requires your own account.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <Label className="text-xs whitespace-nowrap">Confidence:</Label>
                    <Select value={fsaConfFilter} onValueChange={(v) => setFsaConfFilter(v as FsaConfFilter)}>
                      <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-auto">
                      <input type="checkbox" checked={fsaShowDismissed} onChange={(e) => setFsaShowDismissed(e.target.checked)} className="rounded" />
                      Show dismissed
                    </label>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleFsaSort("date")}>
                          <span className="inline-flex items-center gap-1">Date {fsaSortCol === "date" ? (fsaSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}</span>
                        </TableHead>
                        <TableHead>Payee</TableHead>
                        <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleFsaSort("amount")}>
                          <span className="inline-flex items-center gap-1 justify-end">Amount {fsaSortCol === "amount" ? (fsaSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}</span>
                        </TableHead>
                        <TableHead>FSA Category</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleFsaSort("confidence")}>
                          <span className="inline-flex items-center gap-1">Confidence {fsaSortCol === "confidence" ? (fsaSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}</span>
                        </TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredFsa.length === 0 && fsaData.eligible_transactions.length > 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                            No transactions match the current filter.{" "}
                            <button
                              type="button"
                              className="text-primary underline"
                              onClick={() => {
                                setFsaConfFilter("all");
                                setFsaShowDismissed(true);
                              }}
                            >
                              Clear filters
                            </button>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {filteredFsa.map((t) => (
                        <TableRow key={t.transaction_id} className={cn(t.status === "dismissed" && "opacity-50")}>
                          <TableCell className="text-sm">{new Date(t.date).toLocaleDateString()}</TableCell>
                          <TableCell className="font-medium">{t.payee_name}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(t.amount)}</TableCell>
                          <TableCell><Badge variant="outline">{t.fsa_category}</Badge></TableCell>
                          <TableCell>
                            <Badge className={cn(
                              t.confidence === "high" && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                              t.confidence === "medium" && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                              t.confidence === "low" && "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
                            )}>
                              {t.confidence}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs">{t.reason}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {t.status === "claimed" ? (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
                                  <Check className="h-3 w-3" />Claimed
                                </Badge>
                              ) : t.status === "dismissed" ? (
                                <button
                                  type="button"
                                  title={isDemo ? "Demo is read-only" : "Undo dismiss"}
                                  disabled={isDemo}
                                  className={cn(
                                    "text-muted-foreground hover:text-foreground",
                                    isDemo && "opacity-50 cursor-not-allowed hover:text-muted-foreground",
                                  )}
                                  onClick={() =>
                                    !isDemo && fsaStatusMutation.mutate({ txnId: t.transaction_id, status: "pending" })
                                  }
                                >
                                  <Undo2 className="h-4 w-4" />
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    title={isDemo ? "Demo is read-only" : "Mark as claimed"}
                                    disabled={isDemo}
                                    className={cn(
                                      "text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200",
                                      isDemo && "opacity-50 cursor-not-allowed hover:text-green-600 dark:hover:text-green-400",
                                    )}
                                    onClick={() =>
                                      !isDemo && fsaStatusMutation.mutate({ txnId: t.transaction_id, status: "claimed" })
                                    }
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    title={isDemo ? "Demo is read-only" : "Dismiss"}
                                    disabled={isDemo}
                                    className={cn(
                                      "text-muted-foreground hover:text-destructive",
                                      isDemo && "opacity-50 cursor-not-allowed hover:text-muted-foreground",
                                    )}
                                    onClick={() =>
                                      !isDemo && fsaStatusMutation.mutate({ txnId: t.transaction_id, status: "dismissed" })
                                    }
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Heuristic scan plus AI guesses—not a substitute for your plan documents or administrator. The API may cap how many recent outflows are scanned; totals can be incomplete. {AI_COPY.educationalDisclaimer}
              </p>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
