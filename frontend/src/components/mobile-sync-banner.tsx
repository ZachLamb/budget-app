"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { syncApi } from "@/lib/api/sync";
import { useIsClient } from "@/lib/hooks";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Surfaces last sync failure/partial completion on small screens (sidebar is behind the menu). */
export function MobileSyncBanner() {
  const isClient = useIsClient();
  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : 15000),
    enabled: isClient,
  });

  const last = syncStatus?.last_sync;
  const show =
    last?.completed_at &&
    last.status !== "success" &&
    last.status !== "in_progress";

  if (!show) return null;

  return (
    <div
      className="md:hidden border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm"
      role="status"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <p className="flex-1 min-w-48 text-foreground">
          <span className="font-medium">Sync {last.status === "partial" ? "partial" : "failed"}.</span>{" "}
          {last.error_message ?? "Check your bank connection in Settings."}
        </p>
        <Button variant="outline" size="sm" className="h-8" asChild>
          <Link href="/settings">Settings</Link>
        </Button>
      </div>
    </div>
  );
}
