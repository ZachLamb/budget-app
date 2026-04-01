"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { syncApi } from "@/lib/api/sync";
import { useIsClient, getApiErrorMessage } from "@/lib/hooks";
import { resolveMobileDataBarKind } from "@/lib/ux-plan-logic";
import { AlertCircle, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Unified mobile strip for sync state (sidebar is behind the menu).
 * Severity: syncing → bank data may be outdated → last run failed/partial.
 */
export function MobileSyncBanner() {
  const isClient = useIsClient();
  const queryClient = useQueryClient();
  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : 15000),
    enabled: isClient,
  });

  const syncMutation = useMutation({
    mutationFn: syncApi.trigger,
    onSuccess: () => {
      toast.success("Sync started");
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to start sync")),
  });

  const last = syncStatus?.last_sync;
  const kind = resolveMobileDataBarKind(
    !!syncStatus?.syncing,
    !!syncStatus?.is_stale,
    last ?? undefined,
  );
  if (!kind) return null;

  if (kind === "syncing") {
    return (
      <div
        className="md:hidden border-b border-blue-200/80 bg-blue-50/90 dark:border-blue-900 dark:bg-blue-950/40 px-4 py-2.5 text-sm text-blue-900 dark:text-blue-100"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <p className="flex-1 min-w-48">Updating your data from connected banks…</p>
        </div>
      </div>
    );
  }

  if (kind === "stale") {
    const completed = last?.completed_at
      ? new Date(last.completed_at).toLocaleString()
      : null;
    return (
      <div
        className="md:hidden border-b border-amber-200/80 bg-amber-50/90 dark:border-amber-900/60 dark:bg-amber-950/30 px-4 py-2.5 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <p className="flex-1 min-w-48 text-foreground">
            <span className="font-medium">Bank data may be outdated.</span>{" "}
            Figures might not include your latest transactions.
            {completed ? (
              <span className="text-muted-foreground"> Last successful sync: {completed}.</span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-amber-300 dark:border-amber-800"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncMutation.isPending && "animate-spin")} />
              Sync now
            </Button>
            <Button variant="ghost" size="sm" className="h-8" asChild>
              <Link href="/settings">Details</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="md:hidden border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <p className="flex-1 min-w-48 text-foreground">
          <span className="font-medium">Sync {last?.status === "partial" ? "partial" : "failed"}.</span>{" "}
          {last?.error_message ?? "Check your bank connection in Settings."}
        </p>
        <Button variant="outline" size="sm" className="h-8" asChild>
          <Link href="/settings">Settings</Link>
        </Button>
      </div>
    </div>
  );
}
