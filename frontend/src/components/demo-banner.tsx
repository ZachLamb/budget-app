"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useDemoGuard } from "@/lib/hooks";

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { isDemo } = useDemoGuard();

  if (!isDemo || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
      <span>
        You&apos;re viewing a demo with sample data. Changes are read-only.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 hover:bg-amber-200 dark:hover:bg-amber-800/50"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
