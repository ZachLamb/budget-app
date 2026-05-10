"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, RefreshCw, ExternalLink, Server, HardDrive, Cpu, Loader2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { hostingApi, type HostingApp, type HostingHealth, type HostingMachine, type HostingVolume } from "@/lib/api/hosting";
import { toastApiError } from "@/lib/toast-error";

function formatMemory(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`;
  return `${mb} MB`;
}

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  } catch {
    return "—";
  }
}

function MachineRow({ m }: { m: HostingMachine }) {
  const sizeLabel = `${m.cpu_kind}-cpu-${m.cpus}x · ${formatMemory(m.memory_mb)}`;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Cpu className="size-4 text-muted-foreground shrink-0" />
        <span className="font-mono text-xs text-muted-foreground truncate">{m.id.slice(0, 8)}</span>
        <span>·</span>
        <span>{sizeLabel}</span>
        <span>·</span>
        <span className="text-muted-foreground">{m.region}</span>
      </div>
      <Badge variant={m.state === "started" ? "secondary" : "outline"} className="shrink-0 text-xs">
        {m.state}
      </Badge>
    </div>
  );
}

function VolumeRow({ v }: { v: HostingVolume }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <HardDrive className="size-4 text-muted-foreground shrink-0" />
        <span>{v.name || v.id.slice(0, 8)}</span>
        <span>·</span>
        <span>{v.size_gb} GB</span>
        <span>·</span>
        <span className="text-muted-foreground">{v.region}</span>
      </div>
    </div>
  );
}

function AppBlock({ app }: { app: HostingApp }) {
  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2 text-sm font-medium">
        <Server className="size-4 text-muted-foreground" />
        <span>{app.app_name}</span>
        {!app.available && (
          <Badge variant="outline" className="text-xs">unavailable</Badge>
        )}
      </header>
      {!app.available ? (
        <p className="text-xs text-muted-foreground pl-6">
          {app.error || "Couldn't reach Fly for this app."}
        </p>
      ) : (
        <div className="pl-6 space-y-1.5">
          {app.machines.length === 0 ? (
            <p className="text-xs text-muted-foreground">No machines.</p>
          ) : (
            app.machines.map((m) => <MachineRow key={m.id} m={m} />)
          )}
          {app.volumes.map((v) => (
            <VolumeRow key={v.id} v={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function StatusBanner({ health }: { health: HostingHealth }) {
  if (!health.available) {
    return (
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <AlertTriangle className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">Hosting status unavailable</div>
          <div className="text-muted-foreground text-xs">
            FLY_API_TOKEN isn&apos;t set, or Fly&apos;s API is unreachable.
            The card still renders so you know it&apos;s wired; check
            backend env vars to enable real data.
          </div>
        </div>
      </div>
    );
  }
  if (health.drift.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-green-600/30 bg-green-50/30 dark:bg-green-950/20 p-3 text-sm">
        <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-green-600" />
        <div>
          <div className="font-medium">Config matches free-tier blueprint</div>
          <div className="text-muted-foreground text-xs">
            Up to {health.blueprint.app_machines} app machine + {health.blueprint.db_machines} Postgres
            machine, shared-cpu-1x, ≤{health.blueprint.volume_gb} GB volume. Stays inside Fly&apos;s
            free allowance at this shape.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/20 p-3 text-sm">
      <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600" />
      <div className="flex-1 space-y-1">
        <div className="font-medium">Config drift detected</div>
        <ul className="text-xs space-y-0.5 text-muted-foreground">
          {health.drift.map((d) => (
            <li key={d}>• {d}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          See exact spend at the Fly billing dashboard ↗
        </p>
      </div>
    </div>
  );
}

export function HostingHealthCard() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["hostingHealth"],
    queryFn: () => hostingApi.getHealth(false),
    // Server caches 5 min; client matches.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await hostingApi.getHealth(true);
      qc.setQueryData(["hostingHealth"], fresh);
    } catch (e) {
      toastApiError("Couldn't refresh hosting status", e);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hosting health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load hosting status. Refresh, or check the backend logs.
          </p>
        ) : (
          <>
            <StatusBanner health={data} />
            <Separator />
            <div className="space-y-5">
              {data.apps.map((app) => (
                <AppBlock key={app.app_name} app={app} />
              ))}
            </div>
            <Separator />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Last checked {formatRelative(data.last_checked)}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="h-7 px-2"
                >
                  {refreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  Refresh
                </Button>
                <Link
                  href="https://fly.io/dashboard/personal/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  Fly billing <ExternalLink className="size-3" />
                </Link>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
