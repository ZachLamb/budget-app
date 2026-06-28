"use client";

import { cn } from "@/lib/utils";

export interface OnDeviceAiInstructionsProps {
  steps: string[];
  className?: string;
}

/** Numbered setup steps — shared by Settings, wizard, and help dialog. */
export function OnDeviceAiInstructions({ steps, className }: OnDeviceAiInstructionsProps) {
  return (
    <ol className={cn("list-decimal space-y-2 pl-5 text-sm text-muted-foreground", className)}>
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}
