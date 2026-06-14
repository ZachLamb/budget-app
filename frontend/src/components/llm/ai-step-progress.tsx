"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineProgress } from "@/lib/llm/pipelines/types";

export interface AiStepProgressProps {
  /** Latest progress emitted by the running pipeline, or null when idle. */
  progress: PipelineProgress | null;
  /** Abort the running pipeline. */
  onCancel: () => void;
  className?: string;
}

/**
 * Live step-progress row for a running on-device pipeline: shows the current
 * step label and a Cancel button. Announced politely via `role="status"`.
 */
export function AiStepProgress({
  progress,
  onCancel,
  className,
}: AiStepProgressProps) {
  if (!progress) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2",
        className,
      )}
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {progress.label}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  );
}
