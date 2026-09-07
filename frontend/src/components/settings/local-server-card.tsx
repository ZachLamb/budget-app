"use client";

import { AlertTriangle, CheckCircle2, Circle, Server, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LlmBackendStatus } from "@/lib/api/settings";
import {
  describeLocalServer,
  canEnableLocalServer,
  localServerStatusLabel,
} from "@/lib/llm/local-server-status";
import { cn } from "@/lib/utils";

interface Props {
  status: LlmBackendStatus | undefined;
  preferLocalServer: boolean;
  saving: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}

const STATUS_STYLES = {
  connected: {
    icon: CheckCircle2,
    iconClass: "text-green-500",
    badgeClass: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
  },
  unreachable: {
    icon: AlertTriangle,
    iconClass: "text-amber-500",
    badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  "not-configured": {
    icon: Circle,
    iconClass: "text-muted-foreground/50",
    badgeClass: "border-border text-muted-foreground",
  },
} as const;

export function LocalServerCard({ status, preferLocalServer, saving, disabled, onToggle }: Props) {
  const state = describeLocalServer(status);
  const connected = state.kind === "connected";
  const remote = state.kind === "connected" && !state.isLocal;
  // Can turn ON only when reachable AND local; can always turn OFF.
  const toggleDisabled = saving || disabled || (!preferLocalServer && !canEnableLocalServer(status));
  const style = STATUS_STYLES[state.kind];
  const StatusIcon = style.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
              Local model server
            </CardTitle>
            <CardDescription>
              Run a more capable model on your own machine (LM Studio, Ollama) and use it across
              every AI feature. On-device models stay as the automatic fallback.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn("shrink-0 gap-1.5 py-1", style.badgeClass)}>
            <StatusIcon className="h-3 w-3" aria-hidden />
            {localServerStatusLabel(status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected && status && status.models.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {status.models.map((m) => (
              <Badge
                key={m}
                variant={m === status.active_model ? "secondary" : "outline"}
                className="font-mono text-[10px] font-normal"
              >
                {m}
              </Badge>
            ))}
          </div>
        )}

        {state.kind === "not-configured" && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            No server is configured. Point the backend at one by setting{" "}
            <code className="rounded bg-muted px-1 py-0.5">LLM_BACKEND_URL</code> (e.g.{" "}
            <code className="rounded bg-muted px-1 py-0.5">http://localhost:1234</code> for LM
            Studio) and <code className="rounded bg-muted px-1 py-0.5">LLM_BACKEND_MODEL</code>,
            then restart it.
          </div>
        )}
        {state.kind === "unreachable" && (
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>
              The server is configured but not responding — start its local server (in LM Studio:
              Developer → Start Server) and load a model.
              {preferLocalServer &&
                " Until it's back, AI features fall back to on-device models automatically."}
            </p>
          </div>
        )}
        {remote && (
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>
              This server isn&apos;t on your machine, so it can&apos;t be used as a one-tap primary
              model — sending your data to it would leave your device and requires explicit
              per-feature approval. Point{" "}
              <code className="rounded bg-muted px-1 py-0.5">LLM_BACKEND_URL</code> at a local
              address to enable it here.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <span className="text-sm font-medium">Use as my primary AI model</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {connected
                ? "Every AI feature tries your local server first; on-device is the automatic fallback if it's unreachable."
                : "Available once a local server is connected."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={preferLocalServer}
            aria-label="Use local server as primary AI model"
            disabled={toggleDisabled}
            onClick={() => onToggle(!preferLocalServer)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50",
              preferLocalServer ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                preferLocalServer ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
