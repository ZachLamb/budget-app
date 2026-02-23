"use client";

import { AuthGuard } from "@/components/auth-guard";
import { useQuery } from "@tanstack/react-query";
import { syncApi, type SyncLog } from "@/lib/api/sync";
import { useAuth } from "@/lib/providers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function SettingsContent() {
  const { user } = useAuth();
  const { data: syncStatus } = useQuery({ queryKey: ["syncStatus"], queryFn: syncApi.status });
  const { data: syncHistory = [] } = useQuery({ queryKey: ["syncHistory"], queryFn: syncApi.history });

  const statusColor = (status: string) => {
    switch (status) {
      case "success": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "error": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "in_progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span>{user?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="outline">{user?.role}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync Status</CardTitle>
          <CardDescription>
            Bank sync runs on login (if stale), every 4 hours, or manually via the sidebar button
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncStatus?.last_sync ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className={statusColor(syncStatus.last_sync.status)}>{syncStatus.last_sync.status}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last synced</span>
                <span>{syncStatus.last_sync.completed_at ? new Date(syncStatus.last_sync.completed_at).toLocaleString() : "In progress"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transactions imported</span>
                <span>{syncStatus.last_sync.transactions_imported}</span>
              </div>
              {syncStatus.last_sync.error_message && (
                <p className="text-sm text-destructive">{syncStatus.last_sync.error_message}</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No syncs yet. Configure your SimpleFIN access URL and click &ldquo;Sync Now&rdquo; in the sidebar.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
        </CardHeader>
        <CardContent>
          {syncHistory.length === 0 ? (
            <p className="text-muted-foreground">No sync history.</p>
          ) : (
            <div className="space-y-2">
              {syncHistory.map((log: SyncLog) => (
                <div key={log.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge className={statusColor(log.status)} variant="secondary">{log.status}</Badge>
                    <span>{new Date(log.started_at).toLocaleString()}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {log.accounts_synced} accounts, {log.transactions_imported} transactions
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}
