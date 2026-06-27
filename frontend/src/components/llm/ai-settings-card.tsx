"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { getCapability } from "@/lib/llm/capability";
import { setDownloadModel } from "@/lib/llm/consent";
import {
  clearModelFromCache,
  getModelDownloadStatus,
  type ModelDownloadStatus,
} from "@/lib/llm/storage";
import type { CapabilitySnapshot } from "@/lib/llm/types";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

export function AiSettingsCard() {
  const gate = useAiFeatureGate();
  const [cap, setCap] = useState<CapabilitySnapshot | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<ModelDownloadStatus | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);

  const refreshDownloadStatus = useCallback(async (force = false) => {
    try {
      const status = await getModelDownloadStatus(force);
      setDownloadStatus(status);
    } catch {
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

  const isModelDownloaded = downloadStatus?.kind === "downloaded";
  const downloadedSizeLabel = isModelDownloaded ? downloadStatus.sizeLabel : null;

  const nanoStatus = cap?.nano.status ?? null;
  const nanoReady = nanoStatus === "available";
  const nanoSetupPending = nanoStatus === "downloadable" || nanoStatus === "downloading";
  const webLlmFallbackUsable =
    cap !== null && !cap.nano.available && cap.webgpu.modelSize !== "none";
  const noOnDeviceOption =
    cap !== null && !cap.nano.available && cap.webgpu.modelSize === "none";

  const startOnDeviceSetup = useCallback(async () => {
    setSetupLoading(true);
    try {
      await gate.ensureLocalSetup("categorize_transaction");
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <header>
            <h3 className="text-sm font-medium">On-device model</h3>
            <p className="text-sm text-muted-foreground">
              Runs entirely in your browser. Download once, then works offline.
            </p>
          </header>

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

          {webLlmFallbackUsable && (
            <>
              {!isModelDownloaded && (
                <p className="text-sm text-muted-foreground">
                  A downloadable fallback model (
                  {downloadStatus?.kind === "not-downloaded"
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

          {noOnDeviceOption && (
            <div
              role="status"
              className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">On-device AI isn&apos;t available here</p>
              <p className="mt-1">
                Use Chrome or Edge on desktop to run AI privately on your device.
              </p>
            </div>
          )}
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
