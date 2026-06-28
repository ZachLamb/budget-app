"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { OnDeviceAiSetupPanel } from "@/components/llm/on-device-ai-setup-panel";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { getCapability } from "@/lib/llm/capability";
import {
  onDeviceAiSettingsIntro,
  resolveOnDeviceAiSettingsPhase,
} from "@/lib/llm/on-device-ai-guide";
import { onDeviceAiReady } from "@/lib/llm/on-device-ai-requirements";
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
    getCapability(true).then(async (c) => {
      if (!mounted) return;
      setCap(c);
      await refreshDownloadStatus(true);
    });
    return () => {
      mounted = false;
    };
  }, [refreshDownloadStatus]);

  const deviceReady = cap !== null && onDeviceAiReady(cap, downloadStatus);
  const isModelDownloaded = downloadStatus?.kind === "downloaded";
  const downloadedSizeLabel = isModelDownloaded ? downloadStatus.sizeLabel : null;

  const nanoStatus = cap?.nano.status ?? null;
  const nanoSetupPending = nanoStatus === "downloadable" || nanoStatus === "downloading";
  const webLlmFallbackUsable =
    cap !== null && !cap.nano.available && cap.webgpu.modelSize !== "none";
  const noOnDeviceOption =
    cap !== null && !cap.nano.available && cap.webgpu.modelSize === "none";

  const phase = resolveOnDeviceAiSettingsPhase({
    cap,
    deviceReady,
    nanoSetupPending,
    webLlmFallbackUsable,
    isModelDownloaded,
    noOnDeviceOption,
  });

  const handleClearOnDeviceModel = useCallback(async () => {
    setClearing(true);
    try {
      await clearModelFromCache();
      setDownloadModel("denied");
      await refreshDownloadStatus(true);
      setCap(await getCapability(true));
      appToast.success("Fallback model cleared from browser storage");
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
        <CardTitle className="text-base">On-device AI</CardTitle>
        <CardDescription>{onDeviceAiSettingsIntro(phase)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <OnDeviceAiSetupPanel
          localSetup={gate.localSetup}
          onActivate={() => gate.ensureLocalSetup("categorize_transaction")}
        />

        {phase === "active" && isModelDownloaded && !cap?.nano.available && (
          <div className="flex flex-wrap gap-2">
            <p className="w-full text-sm text-muted-foreground">
              Using a fallback model cached in this browser
              {downloadedSizeLabel ? ` (${downloadedSizeLabel})` : ""}.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClearOpen(true)}
              disabled={clearing}
            >
              <Trash2 className="size-4" /> Clear cached model
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={(open) => {
          if (clearing) return;
          setConfirmClearOpen(open);
        }}
        title="Clear fallback model from browser?"
        description={`Removes ${downloadedSizeLabel ?? "the cached model files"} from this browser. You can download again anytime.`}
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
