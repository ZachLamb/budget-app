"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { llmApi } from "@/lib/api/llm";
import { listFeatures } from "@/lib/llm/features";
import { getCapability } from "@/lib/llm/capability";
import { setDownloadModel } from "@/lib/llm/consent";
import { clearModelFromCache, getModelDownloadStatus, type ModelDownloadStatus } from "@/lib/llm/storage";
import type { CapabilitySnapshot } from "@/lib/llm/types";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

export function AiSettingsCard() {
  const qc = useQueryClient();
  const gate = useAiFeatureGate();
  const [cap, setCap] = useState<CapabilitySnapshot | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<ModelDownloadStatus | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [cloudToggling, setCloudToggling] = useState(false);

  const refreshDownloadStatus = useCallback(async (force = false) => {
    try {
      const status = await getModelDownloadStatus(force);
      setDownloadStatus(status);
    } catch {
      // Storage probe failures shouldn't break settings — fall back to unknown.
      setDownloadStatus(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getCapability().then((c) => {
      if (!mounted) return;
      setCap(c);
      void refreshDownloadStatus(true);
    });
    return () => {
      mounted = false;
    };
  }, [refreshDownloadStatus]);

  const grants = useQuery({
    queryKey: ["llmCloudConsent"],
    queryFn: () => llmApi.listCloudConsent(),
  });

  const revokeAll = useMutation({
    mutationFn: () => llmApi.revokeAllCloudConsent(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llmCloudConsent"] });
      appToast.success("Cloud AI disabled");
    },
    onError: (e) => toastApiError("Failed to disable cloud AI", e),
  });

  const activeGrants = (grants.data ?? []).filter((g) => !g.revokedAt);
  const cloudPossibleFeatures = listFeatures().filter((f) => f.cloudPossible);
  const isCloudEnabled = activeGrants.length > 0;
  const isModelDownloaded = downloadStatus?.kind === "downloaded";
  const downloadedSizeLabel = isModelDownloaded ? downloadStatus.sizeLabel : null;

  // Nano (Tier 1) is the primary on-device path. When it isn't usable we fall
  // back to the web-llm (Tier 2) download flow for the lighter features.
  const nanoStatus = cap?.nano.status ?? null;
  const nanoReady = nanoStatus === "available";
  const nanoSetupPending = nanoStatus === "downloadable" || nanoStatus === "downloading";
  const webLlmFallbackUsable =
    cap !== null && !cap.nano.available && cap.webgpu.modelSize !== "none";
  const noOnDeviceOption =
    cap !== null && !cap.nano.available && cap.webgpu.modelSize === "none";

  // Keep-alive: silently re-grant all cloud features to reset the 90-day expiry window.
  const keepAliveRan = useRef(false);
  useEffect(() => {
    if (keepAliveRan.current || !grants.data) return;
    const active = grants.data.filter((g) => !g.revokedAt);
    if (active.length === 0) return;
    keepAliveRan.current = true;
    const features = listFeatures().filter((f) => f.cloudPossible);
    void Promise.allSettled(features.map((f) => llmApi.grantCloudConsent(f.id)));
  }, [grants.data]);

  const startOnDeviceSetup = useCallback(async () => {
    setSetupLoading(true);
    try {
      await gate.ensureLocalSetup("categorize_transaction");
      // Re-probe capability so a completed Nano download flips the status
      // block "downloadable/downloading" → "available" without a remount.
      const nextCap = await getCapability(true);
      setCap(nextCap);
      await refreshDownloadStatus(true);
      const status = await getModelDownloadStatus(true);
      if (nextCap.nano.status === "available") {
        appToast.success("On-device AI is ready");
      } else if (status.kind === "downloaded") {
        appToast.success("On-device AI model is ready");
      }
    } catch {
      // User cancelled or setup failed — wizard surfaces errors.
    } finally {
      setSetupLoading(false);
    }
  }, [gate, refreshDownloadStatus]);

  const handleClearOnDeviceModel = useCallback(async () => {
    setClearing(true);
    try {
      await clearModelFromCache();
      setDownloadModel("denied");
      await refreshDownloadStatus(true);
      appToast.success("On-device model cleared");
    } catch (err) {
      toastApiError("Failed to clear on-device model", err);
    } finally {
      setClearing(false);
      setConfirmClearOpen(false);
    }
  }, [refreshDownloadStatus]);

  const handleCloudToggle = useCallback(
    async (checked: boolean) => {
      setCloudToggling(true);
      try {
        if (checked) {
          const results = await Promise.allSettled(
            cloudPossibleFeatures.map((f) => llmApi.grantCloudConsent(f.id)),
          );
          const failures = results.filter((r) => r.status === "rejected");
          if (failures.length > 0) {
            appToast.warning(
              `Cloud AI partially enabled — ${failures.length} feature(s) failed`,
            );
          } else {
            appToast.success("Cloud AI enabled");
          }
        } else {
          await revokeAll.mutateAsync();
        }
        await qc.invalidateQueries({ queryKey: ["llmCloudConsent"] });
      } catch (err) {
        toastApiError("Failed to update cloud AI setting", err);
      } finally {
        setCloudToggling(false);
      }
    },
    [cloudPossibleFeatures, revokeAll, qc],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Section 1: On-device AI ── */}
        <section className="space-y-3">
          <header>
            <h3 className="text-sm font-medium">On-device model</h3>
            <p className="text-sm text-muted-foreground">
              Runs entirely in your browser. Download once, then works offline.
            </p>
          </header>

          {/* Nano ready — nothing to download, runs in-browser. */}
          {nanoReady && (
            <div
              role="status"
              className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm"
            >
              <p className="font-medium text-foreground">On-device AI ready</p>
              <p className="mt-1 text-muted-foreground">
                Gemini Nano runs locally in your browser — private, free, and works offline.
              </p>
            </div>
          )}

          {/* Nano available but not yet downloaded — needs a user gesture. */}
          {nanoSetupPending && (
            <div className="space-y-3">
              <div
                role="status"
                className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm"
              >
                <p className="font-medium text-foreground">Setting up on-device AI…</p>
                <p className="mt-1 text-muted-foreground">
                  Your browser can run Gemini Nano on-device. A quick one-time setup downloads
                  the model — then it works offline.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void startOnDeviceSetup()}
                disabled={setupLoading}
              >
                {setupLoading ? "Setting up…" : "Set up on-device AI"}
              </Button>
            </div>
          )}

          {/* Web-llm fallback for the lighter features when Nano isn't usable. */}
          {webLlmFallbackUsable && (
            <>
              {!isModelDownloaded && (
                <p className="text-sm text-muted-foreground">
                  A downloadable fallback model ({downloadStatus?.kind === "not-downloaded"
                    ? downloadStatus.sizeLabel
                    : "~1.8 GB"}
                  ) can power the lighter AI features on this device.
                </p>
              )}
              {isModelDownloaded && (
                <p className="text-sm text-muted-foreground">
                  Fallback model ready{downloadedSizeLabel ? ` (${downloadedSizeLabel})` : ""}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {!isModelDownloaded && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void startOnDeviceSetup()}
                    disabled={setupLoading}
                  >
                    {setupLoading ? "Setting up…" : "Download fallback model"}
                  </Button>
                )}
                {isModelDownloaded && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmClearOpen(true)}
                    disabled={clearing}
                  >
                    <Trash2 className="size-4" /> Clear cached model
                  </Button>
                )}
              </div>
            </>
          )}

          {/* No on-device option at all — point to a supported browser. */}
          {noOnDeviceOption && (
            <div
              role="status"
              className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">On-device AI isn&apos;t available here</p>
              <p className="mt-1">
                Use Chrome or Edge on desktop to run AI privately on your device. Other browsers
                fall back to cloud AI for advanced features.
              </p>
            </div>
          )}
        </section>

        <Separator />

        {/* ── Section 2: Cloud AI ── */}
        <section className="space-y-3">
          <header>
            <h3 className="text-sm font-medium">Cloud AI</h3>
            <p className="text-sm text-muted-foreground">
              Off by default. Required for advanced features the small on-device model can&apos;t
              handle. Hosted on our private servers &mdash; never logged, never used for training.{" "}
              <Link href="/privacy" className="underline inline-flex items-center gap-1">
                Privacy details <ExternalLink className="size-3" />
              </Link>
            </p>
          </header>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="cloud-ai-toggle" className="text-sm font-medium cursor-pointer">
              Allow cloud AI
            </label>
            <Switch
              id="cloud-ai-toggle"
              checked={isCloudEnabled}
              onCheckedChange={(checked) => void handleCloudToggle(checked)}
              disabled={cloudToggling || revokeAll.isPending}
            />
          </div>
        </section>
      </CardContent>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={(open) => {
          if (clearing) return;
          setConfirmClearOpen(open);
        }}
        title="Clear on-device AI model?"
        description={`Frees ${downloadedSizeLabel ?? "the cached model files"}. You can re-download anytime.`}
        confirmLabel="Clear"
        loadingLabel="Clearing…"
        loading={clearing}
        closeOnConfirm={false}
        onConfirm={() => {
          void handleClearOnDeviceModel();
        }}
      />
    </Card>
  );
}
