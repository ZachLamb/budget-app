"use client";

import { useState } from "react";
import type { SyncLog, SyncStatus } from "@/lib/api/sync";
import type { SimplefinStatus } from "@/lib/api/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/page";
import { Link2, ExternalLink, RefreshCw, AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const SIMPLEFIN_BRIDGE_URL = "https://beta-bridge.simplefin.org/";

function statusColor(status: string) {
  switch (status) {
    case "success":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function BankSyncSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

export function BankSyncCard({
  simplefinStatus,
  simplefinLoading,
  simplefinError,
  simplefinErr,
  refetchSimplefin,
  syncStatus,
  syncStatusLoading,
  syncStatusError,
  syncStatusErr,
  refetchSyncStatus,
  syncHistory,
  syncHistoryLoading,
  syncHistoryError,
  syncHistoryErr,
  refetchSyncHistory,
  onConnectClick,
}: {
  simplefinStatus?: SimplefinStatus;
  simplefinLoading: boolean;
  simplefinError: boolean;
  simplefinErr: unknown;
  refetchSimplefin: () => void;
  syncStatus?: SyncStatus;
  syncStatusLoading: boolean;
  syncStatusError: boolean;
  syncStatusErr: unknown;
  refetchSyncStatus: () => void;
  syncHistory: SyncLog[];
  syncHistoryLoading: boolean;
  syncHistoryError: boolean;
  syncHistoryErr: unknown;
  refetchSyncHistory: () => void;
  onConnectClick: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const connectionExpired =
    simplefinStatus?.configured &&
    syncStatus?.last_sync?.status === "error" &&
    syncStatus.last_sync.error_message?.toLowerCase().includes("expired or revoked");

  return (
    <Card id="bank" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Bank &amp; sync
        </CardTitle>
        <CardDescription>
          Connect accounts via SimpleFIN for automatic imports. Sync runs on a schedule or when you
          use Sync now in the sidebar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <QueryState
          isLoading={simplefinLoading}
          isError={simplefinError}
          error={simplefinErr}
          onRetry={() => refetchSimplefin()}
          loadingFallback={<BankSyncSkeleton />}
        >
          {connectionExpired && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Connection expired
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  Your SimpleFIN token was revoked or expired. Reconnect to resume syncing.
                </p>
              </div>
              <Button type="button" size="sm" onClick={onConnectClick} className="shrink-0">
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Reconnect
              </Button>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Bank connection</span>
              {simplefinStatus?.configured ? (
                <Badge
                  variant="outline"
                  className={
                    simplefinStatus.is_access_url
                      ? "text-green-700 border-green-300"
                      : "text-amber-700 border-amber-300"
                  }
                >
                  {simplefinStatus.is_access_url ? "Connected" : "Token saved — sync pending"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not connected
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onConnectClick}>
                {simplefinStatus?.configured ? "Reconnect bank" : "Connect bank"}
              </Button>
              {simplefinStatus?.configured && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    window.open(SIMPLEFIN_BRIDGE_URL, "simplefin", "width=820,height=720,scrollbars=yes")
                  }
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Manage in Bridge
                </Button>
              )}
            </div>
          </div>
        </QueryState>

        <div className="border-t pt-6 space-y-3">
          <h3 className="text-sm font-medium">Last sync</h3>
          <QueryState
            isLoading={syncStatusLoading}
            isError={syncStatusError}
            error={syncStatusErr}
            onRetry={() => refetchSyncStatus()}
            loadingFallback={<BankSyncSkeleton />}
          >
            {syncStatus?.last_sync ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={statusColor(syncStatus.last_sync.status)}>
                    {syncStatus.last_sync.status}
                  </Badge>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">When</span>
                  <span>
                    {syncStatus.last_sync.completed_at
                      ? new Date(syncStatus.last_sync.completed_at).toLocaleString()
                      : "In progress"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Transactions imported</span>
                  <span>{syncStatus.last_sync.transactions_imported}</span>
                </div>
                {syncStatus.last_sync.error_message && (
                  <p className="text-sm text-destructive">{syncStatus.last_sync.error_message}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No sync yet. Connect your bank above, then use Sync now in the sidebar.
              </p>
            )}
          </QueryState>
        </div>

        <div className="border-t pt-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md py-2 text-sm font-medium hover:bg-muted/50 px-2 -mx-2"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((o) => !o)}
          >
            <span>Sync history</span>
            <span className="flex items-center gap-2 text-muted-foreground font-normal">
              {!syncHistoryLoading && syncHistory.length > 0 && (
                <span className="text-xs">{syncHistory.length} runs</span>
              )}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", historyOpen && "rotate-180")}
                aria-hidden
              />
            </span>
          </button>
          {historyOpen && (
            <QueryState
              isLoading={syncHistoryLoading}
              isError={syncHistoryError}
              error={syncHistoryErr}
              onRetry={() => refetchSyncHistory()}
              isEmpty={syncHistory.length === 0}
              emptyDescription="No sync history yet."
              loadingFallback={<p className="text-sm text-muted-foreground py-2">Loading…</p>}
            >
              <ul className="mt-2 space-y-2">
                {syncHistory.map((log: SyncLog) => (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <Badge className={statusColor(log.status)} variant="secondary">
                        {log.status}
                      </Badge>
                      <span>{new Date(log.started_at).toLocaleString()}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {log.accounts_synced} accounts · {log.transactions_imported} transactions
                    </span>
                  </li>
                ))}
              </ul>
            </QueryState>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
