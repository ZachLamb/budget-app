import type { OnDeviceSetupPath } from "@/lib/llm/on-device-ai-guide";
import type { CapabilitySnapshot } from "@/lib/llm/types";

export type WizardStep = "welcome" | "device-check" | "download" | "verify";

export type VerifyStatus = "idle" | "running" | "success" | "error";

export interface WizardProps {
  open: boolean;
  step: WizardStep;
  setupPath: OnDeviceSetupPath;
  nanoStatus: CapabilitySnapshot["nano"]["status"];
  modelSize: "3b" | "1b" | "none";
  freeStorage?: number;
  progress: number;
  progressText?: string;
  verifyStatus: VerifyStatus;
  verifyResult?: string;
  deviceUnsupported: boolean;
  downloadError?: string;
  onNext: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onRetry: () => void;
  onGrantConsent: () => void;
  onToggleLite: (useLite: boolean) => void;
}

export interface UseLocalAiSetup {
  ensureReady: () => Promise<void>;
  wizardProps: WizardProps;
}

/** Subset of wizard state for inline setup UI (Settings, help dialog). */
export type LocalSetupSnapshot = Pick<
  WizardProps,
  "progress" | "progressText" | "step" | "open" | "setupPath" | "nanoStatus" | "verifyStatus"
> & {
  isDownloading: boolean;
};
