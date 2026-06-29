"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { PipelineProgress } from "@/lib/llm/pipelines/types";

export interface AiRunStatusProps {
  /** Pipeline step label, or null when only batch progress applies. */
  progress: PipelineProgress | null;
  batch?: { done: number; total: number } | null;
  onCancel?: () => void;
  className?: string;
}

/**
 * Live status for on-device AI: step label, optional batch bar, and cancel.
 */
export function AiRunStatus({
  progress,
  batch,
  onCancel,
  className,
}: AiRunStatusProps) {
  const batchActive = batch != null && batch.total > 0;
  if (!progress && !batchActive) return null;

  const label =
    progress?.label ??
    (batchActive
      ? `Scanning batch ${batch.done + 1} of ${batch.total}…`
      : "Working…");

  const batchPercent =
    batchActive && batch.total > 0
      ? Math.min(100, Math.round((batch.done / batch.total) * 100))
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "rounded-md border bg-muted/30 px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
          {label}
        </span>
        {onCancel ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs shrink-0"
            onClick={onCancel}
            aria-label="Cancel AI task"
          >
            Cancel
          </Button>
        ) : null}
      </div>
      {batchPercent != null ? (
        <Progress value={batchPercent} className="mt-2 h-1.5" aria-hidden="true" />
      ) : null}
    </div>
  );
}
