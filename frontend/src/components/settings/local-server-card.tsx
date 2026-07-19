"use client";

import { Server } from "lucide-react";
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

export function LocalServerCard({ status, preferLocalServer, saving, disabled, onToggle }: Props) {
  const state = describeLocalServer(status);
  const connected = state.kind === "connected";
  const remote = state.kind === "connected" && !state.isLocal;
  // Can turn ON only when reachable AND local; can always turn OFF.
  const toggleDisabled = saving || disabled || (!preferLocalServer && !canEnableLocalServer(status));

  const dotColor =
    state.kind === "connected"
      ? "bg-green-500"
      : state.kind === "unreachable"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4 text-muted-foreground" />
          Local model server
        </CardTitle>
        <CardDescription>
          Run a more capable model on your own machine (LM Studio, Ollama) and use it as your primary
          AI. On-device models stay as the fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("h-2 w-2 rounded-full", dotColor)} aria-hidden />
          <span className="font-medium">{localServerStatusLabel(status)}</span>
          {connected && status && status.models.length > 1 && (
            <Badge variant="outline" className="text-[10px]">
              {status.models.length} models loaded
            </Badge>
          )}
        </div>

        {state.kind === "not-configured" && (
          <p className="text-xs text-muted-foreground">
            No server is configured. Point the backend at one by setting{" "}
            <code className="rounded bg-muted px-1">LLM_BACKEND_URL</code> (e.g.{" "}
            <code className="rounded bg-muted px-1">http://localhost:1234</code> for LM Studio) and{" "}
            <code className="rounded bg-muted px-1">LLM_BACKEND_MODEL</code>, then restart it.
          </p>
        )}
        {state.kind === "unreachable" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            The server is configured but not responding — start its local server (in LM Studio:
            Developer → Start Server) and load a model.
            {preferLocalServer &&
              " Until it's back, AI features fall back to on-device models automatically."}
          </p>
        )}
        {remote && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This server isn&apos;t on your machine, so it can&apos;t be used as a one-tap private
            model — sending your data to it would leave your device and requires explicit
            per-feature approval. Point <code className="rounded bg-muted px-1">LLM_BACKEND_URL</code>{" "}
            at a local address to enable it here.
          </p>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm font-medium">Use as my primary AI model</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {connected
                ? "AI features run on your local server; on-device is the fallback."
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
