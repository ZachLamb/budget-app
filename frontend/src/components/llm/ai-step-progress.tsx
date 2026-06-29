"use client";

import { AiRunStatus, type AiRunStatusProps } from "./ai-run-status";

/** @deprecated Use AiRunStatus — kept for existing imports. */
export type AiStepProgressProps = Omit<AiRunStatusProps, "batch"> & {
  progress: AiRunStatusProps["progress"];
};

export function AiStepProgress({ progress, onCancel, className }: AiStepProgressProps) {
  return (
    <AiRunStatus
      progress={progress}
      onCancel={onCancel}
      className={className}
    />
  );
}
