"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDashed, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { appToast } from "@/lib/app-toast";
import { getCapability } from "@/lib/llm/capability";
import { detectBrowser } from "@/lib/llm/on-device-ai-guide";
import type { LocalSetupSnapshot } from "@/hooks/local-ai-setup-types";
import {
  buildOnDeviceRequirements,
  countRequirementIssues,
  onDeviceAiReady,
  partitionRequirements,
  primaryInAppAction,
  type OnDeviceRequirement,
  type RequirementStatus,
} from "@/lib/llm/on-device-ai-requirements";
import { getModelDownloadStatus, type ModelDownloadStatus } from "@/lib/llm/storage";
import type { CapabilitySnapshot } from "@/lib/llm/types";

export interface OnDeviceAiSetupPanelProps {
  /** When true, hides section headers and uses tighter spacing (dialogs / empty states). */
  compact?: boolean;
  className?: string;
  localSetup: LocalSetupSnapshot;
  onActivate: () => Promise<void>;
}

function StatusIcon({ status }: { status: RequirementStatus }) {
  switch (status) {
    case "pass":
      return (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500"
          aria-hidden
        />
      );
    case "fail":
      return (
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      );
    case "pending":
      return (
        <Loader2
          className="mt-0.5 size-4 shrink-0 animate-spin text-amber-600 dark:text-amber-500"
          aria-hidden
        />
      );
    default:
      return (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      );
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => appToast.success(`Copied: ${label}`),
          () => appToast.warning("Could not copy — select and copy the text manually."),
        );
      }}
    >
      <Copy className="size-3" aria-hidden />
      Copy
    </Button>
  );
}

function RequirementRow({ req }: { req: OnDeviceRequirement }) {
  return (
    <li className="flex gap-2.5 text-sm">
      <StatusIcon status={req.status} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-snug">
          {req.label}
          {req.optional && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{req.detail}</p>
        {req.action && req.status !== "pass" && (
          <p className="text-xs text-foreground/80">{req.action}</p>
        )}
        {req.manualCopyItems && req.status !== "pass" && (
          <ul className="mt-1 space-y-1.5">
            {req.manualCopyItems.map((item) => (
              <li
                key={item.value}
                className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background/60 px-2 py-1.5"
              >
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <CopyButton value={item.value} label={item.label} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * Unified on-device AI setup: requirement checks, in-app activation, download
 * progress, and manual Chrome steps (copy-only — flags cannot be toggled from JS).
 */
export function OnDeviceAiSetupPanel({
  compact = false,
  className,
  localSetup,
  onActivate,
}: OnDeviceAiSetupPanelProps) {
  const [cap, setCap] = useState<CapabilitySnapshot | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<ModelDownloadStatus | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [activating, setActivating] = useState(false);

  const reload = useCallback(async (force = false) => {
    const nextCap = await getCapability(force);
    setCap(nextCap);
    try {
      setDownloadStatus(await getModelDownloadStatus(force));
    } catch {
      setDownloadStatus(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getCapability(true).then(async (nextCap) => {
      if (!mounted) return;
      setCap(nextCap);
      try {
        setDownloadStatus(await getModelDownloadStatus(true));
      } catch {
        setDownloadStatus(null);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const browser = detectBrowser();
  const requirements =
    cap !== null ? buildOnDeviceRequirements(cap, browser, downloadStatus) : [];
  const active = cap !== null && onDeviceAiReady(cap, downloadStatus);
  const { inApp, manual, ready } = partitionRequirements(requirements);
  const issues = countRequirementIssues(requirements);
  const nextAction = primaryInAppAction(requirements);

  const summary = active
    ? "Active in this browser — built-in AI is handling requests locally."
    : issues === 0
      ? "Browser settings look good — finish any remaining step below."
      : `${issues} requirement${issues === 1 ? "" : "s"} still need${issues === 1 ? "s" : ""} attention.`;

  const actionLabel = (loading: boolean): string => {
    if (loading) {
      return nextAction === "download-fallback" ? "Downloading…" : "Activating…";
    }
    return nextAction === "download-fallback" ? "Download fallback model" : "Activate built-in AI";
  };

  const showProgress =
    localSetup.isDownloading ||
    (localSetup.nanoStatus === "downloading" && localSetup.open);

  if (cap === null) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)} role="status">
        Checking browser capabilities…
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <section
        className="space-y-3 rounded-md border bg-muted/30 p-3"
        aria-labelledby="on-device-setup-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 id="on-device-setup-heading" className="text-sm font-medium">
              Browser requirements
            </h4>
            <p className="text-xs text-muted-foreground">{summary}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={rechecking || activating}
            onClick={() => {
              setRechecking(true);
              void reload(true).finally(() => setRechecking(false));
            }}
          >
            <RefreshCw className={cn("size-3.5", rechecking && "animate-spin")} />
            {rechecking ? "Checking…" : "Re-check"}
          </Button>
        </div>

        {showProgress && (
          <div className="space-y-1.5 rounded-md border bg-background/80 p-3" role="status">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">
                {localSetup.setupPath === "nano"
                  ? "Downloading Gemini Nano…"
                  : "Downloading fallback model…"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {localSetup.progress > 0 ? `${Math.round(localSetup.progress)}%` : "Starting…"}
              </span>
            </div>
            <Progress value={localSetup.progress} />
            {localSetup.progressText && (
              <p className="text-xs text-muted-foreground">{localSetup.progressText}</p>
            )}
            <p className="text-xs text-muted-foreground">Keep this tab open until download finishes.</p>
          </div>
        )}

        {inApp.length > 0 && (
          <div className="space-y-2">
            {!compact && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Fix in Snack&apos;s Budget
              </p>
            )}
            <ul className="space-y-3" role="list">
              {inApp.map((req) => (
                <RequirementRow key={req.id} req={req} />
              ))}
            </ul>
            {nextAction && !showProgress && (
              <Button
                type="button"
                size="sm"
                disabled={activating}
                onClick={() => {
                  setActivating(true);
                  void onActivate().finally(() => setActivating(false));
                }}
              >
                {actionLabel(activating)}
              </Button>
            )}
          </div>
        )}

        {manual.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fix in Chrome (one-time)
            </p>
            <p className="text-xs text-muted-foreground">
              Snack&apos;s Budget cannot enable these browser settings for you. Copy a link, paste it into
              Chrome&apos;s address bar, then return here and click Re-check.
            </p>
            <ul className="space-y-3" role="list">
              {manual.map((req) => (
                <RequirementRow key={req.id} req={req} />
              ))}
            </ul>
          </div>
        )}

        {ready.length > 0 && (inApp.length > 0 || manual.length > 0) && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ready
            </p>
            <ul className="space-y-2" role="list">
              {ready.map((req) => (
                <RequirementRow key={req.id} req={req} />
              ))}
            </ul>
          </div>
        )}

        {ready.length > 0 && inApp.length === 0 && manual.length === 0 && (
          <ul className="space-y-2" role="list">
            {ready.map((req) => (
              <RequirementRow key={req.id} req={req} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
