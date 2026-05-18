"use client";

import type { UseMutationResult } from "@tanstack/react-query";
import type { LlmSuggestion } from "@/lib/api/reports";
import type { FlatCategory } from "@/lib/hooks";
import { AI_COPY } from "@/lib/ai-copy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X } from "lucide-react";

export interface CategoryReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: LlmSuggestion[];
  onSuggestionsChange: (next: LlmSuggestion[]) => void;
  categoryOverrides: Record<string, string>;
  onCategoryOverridesChange: (next: Record<string, string>) => void;
  allCategories: FlatCategory[];
  isDemo: boolean;
  getReviewCategoryId: (s: LlmSuggestion) => string;
  applyOneMutation: UseMutationResult<
    { applied: number },
    unknown,
    { transaction_id: string; category_id: string },
    unknown
  >;
  applyAllMutation: UseMutationResult<
    { applied: number },
    unknown,
    { transaction_id: string; category_id: string }[],
    unknown
  >;
}

export function CategoryReviewDialog({
  open,
  onOpenChange,
  suggestions,
  onSuggestionsChange,
  categoryOverrides,
  onCategoryOverridesChange,
  allCategories,
  isDemo,
  getReviewCategoryId,
  applyOneMutation,
  applyAllMutation,
}: CategoryReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>AI category suggestions</DialogTitle>
          <p className="text-sm text-muted-foreground font-normal">
            Uses uncategorized transactions matching your current filters (account, date range, search), up to 50.
            Review and change categories before applying. {AI_COPY.educationalDisclaimer}
          </p>
        </DialogHeader>
        {suggestions.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">No suggestions in this batch.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="max-h-[min(24rem,50vh)] space-y-2 overflow-y-auto pr-1">
              {suggestions.map((s) => (
                <div
                  key={s.transaction_id}
                  className="flex flex-col gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{s.payee_name}</p>
                    <p className="text-xs text-muted-foreground">Suggested: {s.category_name}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={getReviewCategoryId(s)}
                      onValueChange={(v) =>
                        onCategoryOverridesChange({ ...categoryOverrides, [s.transaction_id]: v })
                      }
                    >
                      <SelectTrigger className="h-8 w-[min(100%,14rem)] text-xs">
                        <SelectValue placeholder="Category" />
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
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={isDemo || applyOneMutation.isPending}
                      title={isDemo ? "Demo is read-only" : undefined}
                      onClick={() => {
                        if (isDemo) return;
                        applyOneMutation.mutate({
                          transaction_id: s.transaction_id,
                          category_id: getReviewCategoryId(s),
                        });
                      }}
                    >
                      Apply
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        onSuggestionsChange(
                          suggestions.filter((x) => x.transaction_id !== s.transaction_id),
                        )
                      }
                      aria-label="Remove from list"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                disabled={
                  isDemo ||
                  applyAllMutation.isPending ||
                  applyOneMutation.isPending ||
                  suggestions.length === 0
                }
                title={isDemo ? "Demo is read-only" : undefined}
                onClick={() => {
                  if (isDemo) return;
                  applyAllMutation.mutate(
                    suggestions.map((s) => ({
                      transaction_id: s.transaction_id,
                      category_id: getReviewCategoryId(s),
                    })),
                  );
                }}
              >
                <Check className="mr-2 h-4 w-4" />
                Apply all ({suggestions.length})
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
