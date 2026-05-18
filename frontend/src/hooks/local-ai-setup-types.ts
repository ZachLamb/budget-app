import type { FeatureId } from "@/lib/llm/features";

export type WizardStep = "welcome" | "device-check" | "download" | "verify";

export type VerifyStatus = "idle" | "running" | "success" | "error";

export interface WizardProps {
  open: boolean;
  step: WizardStep;
  modelSize: "3b" | "1b" | "none";
  freeStorage?: number;
  progress: number;
  progressText?: string;
  verifyStatus: VerifyStatus;
  verifyResult?: string;
  cloudAvailable: boolean;
  deviceUnsupported: boolean;
  downloadError?: string;
  onNext: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onRetry: () => void;
  onCloudFallback: () => void;
  onGrantConsent: () => void;
  onToggleLite: (useLite: boolean) => void;
}

export interface UseLocalAiSetup {
  ensureReady: (feature: FeatureId) => Promise<void>;
  wizardProps: WizardProps;
}
