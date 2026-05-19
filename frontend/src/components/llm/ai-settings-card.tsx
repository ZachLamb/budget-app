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
  const webGpuReady = cap?.webgpu.available === true;

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
      await refreshDownloadStatus(true);
      const status = await getModelDownloadStatus(true);
      if (status.kind === "downloaded") {
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

          {/* Status line */}
          {!webGpuReady && cap !== null && (
            <div
              role="status"
              className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">WebGPU not available in this browser</p>
              <p className="mt-1">
                On-device models need WebGPU. Try Chrome 113+ or Edge on a desktop/laptop.
                Visit <code className="rounded bg-muted px-1 py-0.5 text-xs">chrome://gpu</code>{" "}
                and check that <span className="font-mono text-xs">WebGPU</span> shows
                &quot;Hardware accelerated.&quot; Mobile Safari and Firefox have limited support.
              </p>
            </div>
          )}

          {webGpuReady && !isModelDownloaded && (
            <p className="text-sm text-muted-foreground">Not downloaded yet</p>
          )}

          {isModelDownloaded && (
            <p className="text-sm text-muted-foreground">
              Model ready{downloadedSizeLabel ? ` (${downloadedSizeLabel})` : ""}
            </p>
          )}

          {/* Action button */}
          <div className="flex flex-wrap gap-2">
            {webGpuReady && !isModelDownloaded && (
              <Button
                size="sm"
                onClick={() => void startOnDeviceSetup()}
                disabled={setupLoading}
              >
                {setupLoading ? "Setting up…" : "Set up on-device AI"}
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
