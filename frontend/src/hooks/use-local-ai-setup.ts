"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { FeatureId } from "@/lib/llm/features";
import type {
  UseLocalAiSetup,
  WizardStep,
  VerifyStatus,
} from "./local-ai-setup-types";
import { isDemoMode } from "@/lib/demo-mode";
import {
  getModelDownloadStatus,
  invalidateModelDownloadStatus,
} from "@/lib/llm/storage";
import { getCapability } from "@/lib/llm/capability";
import { getFeaturePolicy } from "@/lib/llm/features";
import { setDownloadModel, setUseLiteModel } from "@/lib/llm/consent";
import {
  ensureEngine,
  webLlmProvider,
} from "@/lib/llm/providers/web-llm-engine";
import {
  formatWebLlmDownloadError,
  normalizeInitProgress,
} from "@/lib/llm/web-llm-download";
import type { CapabilitySnapshot } from "@/lib/llm/types";

interface PendingPromise {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

export function useLocalAiSetup(): UseLocalAiSetup {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("welcome");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState<string | undefined>();
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyResult, setVerifyResult] = useState<string | undefined>();
  const [downloadError, setDownloadError] = useState<string | undefined>();
  const [capability, setCapability] = useState<CapabilitySnapshot | null>(null);
  const [cloudAvailable, setCloudAvailable] = useState(false);

  const pendingRef = useRef<PendingPromise | null>(null);

  const startDownload = useCallback(() => {
    setDownloadError(undefined);
    setProgress(0);
    setProgressText(undefined);

    ensureEngine((p) => {
      setProgress(normalizeInitProgress(p.progress));
      setProgressText(p.text);
    })
      .then(() => {
        invalidateModelDownloadStatus();
        setVerifyStatus("idle");
        setVerifyResult(undefined);
        setStep("verify");
      })
      .catch((err: unknown) => {
        setDownloadError(formatWebLlmDownloadError(err));
      });
  }, []);

  const runVerification = useCallback(async () => {
    setVerifyStatus("running");
    setVerifyResult(undefined);
    try {
      let text = "";
      for await (const chunk of webLlmProvider.generate(
        "Classify: Coffee shop $4.50",
        { system: "Reply with just a category name.", maxTokens: 20 },
      )) {
        text += chunk;
      }
      setVerifyResult(text.trim() || "(empty response)");
      setVerifyStatus("success");
    } catch (err: unknown) {
      setVerifyResult(formatWebLlmDownloadError(err));
      setVerifyStatus("error");
    }
  }, []);

  useEffect(() => {
    if (open && step === "verify" && verifyStatus === "idle" && !downloadError) {
      // Auto-run verification when the wizard lands on the verify step.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off async verification
      void runVerification();
    }
  }, [open, step, verifyStatus, downloadError, runVerification]);

  const ensureReady = useCallback(
    async (feature: FeatureId): Promise<void> => {
      if (isDemoMode) return;

      const status = await getModelDownloadStatus(true);
      if (status.kind === "downloaded") return;

      if (pendingRef.current) return pendingRef.current.promise;

      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pendingRef.current = { promise, resolve, reject };

      const cap = await getCapability(true);
      setCapability(cap);

      const policy = getFeaturePolicy(feature);
      setCloudAvailable(policy.cloudPossible);

      setStep("welcome");
      setProgress(0);
      setProgressText(undefined);
      setVerifyStatus("idle");
      setVerifyResult(undefined);
      setDownloadError(undefined);
      setOpen(true);

      return promise;
    },
    [],
  );

  const onNext = useCallback(() => {
    setStep((prev) => {
      const order: WizardStep[] = [
        "welcome",
        "device-check",
        "download",
        "verify",
      ];
      const idx = order.indexOf(prev);
      return idx < order.length - 1 ? order[idx + 1] : prev;
    });
  }, []);

  const onCancel = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.reject(new Error("User cancelled setup"));
      pendingRef.current = null;
    }
    setDownloadModel("denied");
    setOpen(false);
  }, []);

  const onComplete = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve();
      pendingRef.current = null;
    }
    setOpen(false);
  }, []);

  const onRetry = useCallback(() => {
    if (step === "download") {
      startDownload();
    } else if (step === "verify") {
      runVerification();
    }
  }, [step, startDownload, runVerification]);

  const onCloudFallback = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve();
      pendingRef.current = null;
    }
    setOpen(false);
  }, []);

  const onGrantConsent = useCallback(() => {
    setDownloadModel("granted");
    setStep("download");
    startDownload();
  }, [startDownload]);

  const onToggleLite = useCallback((useLite: boolean) => {
    setUseLiteModel(useLite);
    getCapability(true).then(setCapability);
  }, []);

  const modelSize = capability?.webgpu.modelSize ?? "none";
  const deviceUnsupported = modelSize === "none";
  const freeStorage = capability?.webgpu.storageQuotaBytes;

  return {
    ensureReady,
    wizardProps: {
      open,
      step,
      modelSize,
      freeStorage,
      progress,
      progressText,
      verifyStatus,
      verifyResult,
      cloudAvailable,
      deviceUnsupported,
      downloadError,
      onNext,
      onCancel,
      onComplete,
      onRetry,
      onCloudFallback,
      onGrantConsent,
      onToggleLite,
    },
  };
}
