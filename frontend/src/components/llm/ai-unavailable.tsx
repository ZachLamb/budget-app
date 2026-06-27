"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AiUnavailableProps {
  /**
   * Optional override for the headline. Defaults to an honest, jargon-free
   * line that doesn't mention tiers, providers, or model internals.
   */
  message?: string;
  className?: string;
}

/**
 * Shared empty-state shown when an on-device AI feature can't run in this
 * browser (e.g. the heavy pipelines need Chrome/Edge on desktop). One honest
 * message, no tier/provider jargon. Announced politely and keyboard-focusable.
 */
export function AiUnavailable({ message, className }: AiUnavailableProps) {
  return (
    <div
      role="status"
      tabIndex={0}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Cpu className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">
        {message ?? "This feature needs Chrome or Edge on desktop to run."}
      </p>
      <p className="max-w-[320px] text-xs text-muted-foreground">
        It runs privately on your device, so it isn&apos;t available in this
        browser yet.
      </p>
      <Link
        href="/settings"
        className="text-xs text-primary hover:underline"
      >
        AI settings
      </Link>
    </div>
  );
}
