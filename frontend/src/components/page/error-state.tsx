"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { WifiOff, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  error: unknown;
  message?: string;
  onRetry?: () => void;
  className?: string;
  /** When true, show link to Settings (e.g. AI disabled 403). */
  showSettingsLink?: boolean;
  children?: ReactNode;
}

export function ErrorState({
  error,
  message = "Something went wrong loading this section.",
  onRetry,
  className,
  showSettingsLink,
  children,
}: ErrorStateProps) {
  const detail = getApiErrorMessage(error, message);
  const status = (error as { response?: { status?: number } })?.response?.status;
  const is403 = status === 403;

  return (
    <div className={cn("space-y-2 text-sm py-4", className)} role="alert">
      <p className="text-destructive flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
        {detail}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onRetry()}>
            Retry
          </Button>
        ) : null}
        {(showSettingsLink || is403) && (
          <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
            <Link href="/settings">
              <Settings className="h-3 w-3 mr-1" aria-hidden />
              Settings
            </Link>
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
