"use client";

import {
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cloud,
  Cpu,
  HardDrive,
  Download,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { OnDeviceAiInstructions } from "@/components/llm/on-device-ai-instructions";
import type { WizardProps, WizardStep } from "@/hooks/local-ai-setup-types";
import {
  WIZARD_STEPS,
  PWA_NOT_REQUIRED,
  nanoSetupSteps,
  webLlmSetupSteps,
  unsupportedSteps,
  unsupportedHeadline,
  detectBrowser,
} from "@/lib/llm/on-device-ai-guide";

function formatGB(bytes: number | undefined): string {
  if (bytes === undefined || bytes <= 0) return "—";
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

const MODEL_SIZE_LABEL: Record<string, string> = {
  "3b": "~1.8 GB",
  "1b": "~700 MB",
  none: "—",
};

function WizardStepIndicator({ step }: { step: WizardStep }) {
  const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
  const current = WIZARD_STEPS[idx];
  return (
    <p className="text-xs text-muted-foreground">
      Step {idx + 1} of {WIZARD_STEPS.length}
      {current ? ` — ${current.label}` : ""}
    </p>
  );
}

function WelcomeStep({
  setupPath,
  cloudAvailable,
  onNext,
  onCloudFallback,
}: Pick<WizardProps, "setupPath" | "cloudAvailable" | "onNext" | "onCloudFallback">) {
  const isNano = setupPath === "nano";
  return (
    <>
      <WizardStepIndicator step="welcome" />
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Shield className="size-5" /> Set up on-device AI
        </DialogTitle>
        <DialogDescription>
          AI runs privately in your browser. Your budget data stays on your device — nothing is sent
          to a cloud model for this setup path.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <Monitor className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {PWA_NOT_REQUIRED}
        </p>
      </div>

      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <Cpu className="mt-0.5 size-4 shrink-0" />
          {isNano
            ? "Uses Gemini Nano built into Chrome or Edge — a one-time download, then works offline."
            : "Downloads a small open-source model once (~700 MB–1.8 GB), then works offline."}
        </li>
        <li className="flex items-start gap-2">
          <Shield className="mt-0.5 size-4 shrink-0" />
          Private by default — no account data leaves your device during inference.
        </li>
      </ul>

      <OnDeviceAiInstructions
        steps={isNano ? nanoSetupSteps().slice(0, 2) : webLlmSetupSteps(MODEL_SIZE_LABEL["3b"]).slice(0, 2)}
      />

      <div className="mt-4 flex justify-end gap-2">
        {cloudAvailable && (
          <Button variant="ghost" onClick={onCloudFallback}>
            <Cloud className="mr-1.5 size-4" /> Use cloud AI instead
          </Button>
        )}
        <Button onClick={onNext}>Continue</Button>
      </div>
    </>
  );
}

function DeviceCheckStep({
  setupPath,
  modelSize,
  freeStorage,
  deviceUnsupported,
  cloudAvailable,
  onGrantConsent,
  onCancel,
  onCloudFallback,
  onToggleLite,
}: Pick<
  WizardProps,
  | "setupPath"
  | "modelSize"
  | "freeStorage"
  | "deviceUnsupported"
  | "cloudAvailable"
  | "onGrantConsent"
  | "onCancel"
  | "onCloudFallback"
  | "onToggleLite"
>) {
  const browser = detectBrowser();

  if (deviceUnsupported) {
    return (
      <>
        <WizardStepIndicator step="device-check" />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-destructive" /> Device check
          </DialogTitle>
          <DialogDescription>{unsupportedHeadline(browser)}</DialogDescription>
        </DialogHeader>

        <OnDeviceAiInstructions steps={unsupportedSteps(browser)} />

        <div className="mt-4 flex justify-end gap-2">
          {cloudAvailable && (
            <Button variant="ghost" onClick={onCloudFallback}>
              <Cloud className="mr-1.5 size-4" /> Use cloud AI
            </Button>
          )}
          <Button variant="outline" onClick={onCancel}>
            Dismiss
          </Button>
        </div>
      </>
    );
  }

  if (setupPath === "nano") {
    return (
      <>
        <WizardStepIndicator step="device-check" />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="size-5" /> Ready for Gemini Nano
          </DialogTitle>
          <DialogDescription>
            Your browser supports on-device AI. The next step downloads the model (handled by
            Chrome or Edge).
          </DialogDescription>
        </DialogHeader>

        <OnDeviceAiInstructions steps={nanoSetupSteps().slice(2)} />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Not now
          </Button>
          <Button onClick={onGrantConsent}>Download model</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <WizardStepIndicator step="device-check" />
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HardDrive className="size-5" /> Device check
        </DialogTitle>
        <DialogDescription>
          We&apos;ll download the fallback AI model to your browser storage.
        </DialogDescription>
      </DialogHeader>

      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between rounded-md border p-3">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <Download className="size-4" /> Download size
          </dt>
          <dd className="font-medium">{MODEL_SIZE_LABEL[modelSize]}</dd>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <HardDrive className="size-4" /> Free storage
          </dt>
          <dd className="font-medium">{formatGB(freeStorage)}</dd>
        </div>
      </dl>

      {modelSize === "3b" && (
        <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            onChange={(e) => onToggleLite(e.target.checked)}
            className="rounded"
          />
          Use lite model (~700 MB) for low-storage devices
        </label>
      )}

      <OnDeviceAiInstructions
        steps={webLlmSetupSteps(MODEL_SIZE_LABEL[modelSize] ?? "~1.8 GB").slice(2)}
        className="mt-2"
      />

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Not now
        </Button>
        <Button disabled={modelSize === "none"} onClick={onGrantConsent}>
          Download
        </Button>
      </div>
    </>
  );
}

function DownloadStep({
  setupPath,
  progress,
  progressText,
  downloadError,
  cloudAvailable,
  onRetry,
  onCancel,
  onCloudFallback,
}: Pick<
  WizardProps,
  | "setupPath"
  | "progress"
  | "progressText"
  | "downloadError"
  | "cloudAvailable"
  | "onRetry"
  | "onCancel"
  | "onCloudFallback"
>) {
  const isNano = setupPath === "nano";
  return (
    <>
      <WizardStepIndicator step="download" />
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Download className="size-5" /> Downloading model
        </DialogTitle>
        <DialogDescription>
          {isNano
            ? "Chrome or Edge is downloading Gemini Nano. Keep this tab open."
            : "Downloading the fallback model. This may take several minutes."}
        </DialogDescription>
      </DialogHeader>

      {downloadError ? (
        <>
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {downloadError}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            {cloudAvailable && (
              <Button variant="ghost" onClick={onCloudFallback}>
                <Cloud className="mr-1.5 size-4" /> Use cloud AI
              </Button>
            )}
            <Button onClick={onRetry}>Retry</Button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Progress value={progress} />
            {progressText && (
              <p className="text-center text-xs text-muted-foreground">{progressText}</p>
            )}
            {!progressText && progress > 0 && (
              <p className="text-center text-xs text-muted-foreground">{progress}%</p>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function VerifyStep({
  setupPath,
  verifyStatus,
  verifyResult,
  cloudAvailable,
  onComplete,
  onRetry,
  onCloudFallback,
}: Pick<
  WizardProps,
  | "setupPath"
  | "verifyStatus"
  | "verifyResult"
  | "cloudAvailable"
  | "onComplete"
  | "onRetry"
  | "onCloudFallback"
>) {
  const isNano = setupPath === "nano";
  return (
    <>
      <WizardStepIndicator step="verify" />
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {verifyStatus === "running" && <Loader2 className="size-5 animate-spin" />}
          {verifyStatus === "success" && <CheckCircle2 className="size-5 text-green-600" />}
          {verifyStatus === "error" && <AlertCircle className="size-5 text-destructive" />}
          {verifyStatus === "idle" && <Cpu className="size-5" />}
          {isNano && verifyStatus === "success" ? "Ready" : "Verification"}
        </DialogTitle>
        {verifyStatus === "success" && (
          <DialogDescription>
            On-device AI is ready. You can close this dialog and try AI suggestions again.
          </DialogDescription>
        )}
      </DialogHeader>

      {verifyStatus === "running" && (
        <p className="text-center text-sm text-muted-foreground">Verifying model…</p>
      )}

      {verifyStatus === "success" && (
        <>
          <p className="text-sm text-muted-foreground">
            {isNano
              ? "Gemini Nano is available on this device."
              : "The fallback model responded successfully."}
            {verifyResult && !isNano && (
              <>
                {" "}
                Test result: <span className="font-medium">{verifyResult}</span>
              </>
            )}
          </p>
          <div className="mt-4 flex justify-end">
            <Button onClick={onComplete}>Continue</Button>
          </div>
        </>
      )}

      {verifyStatus === "idle" && !isNano && (
        <p className="text-center text-sm text-muted-foreground">Preparing verification…</p>
      )}

      {verifyStatus === "error" && (
        <>
          <p className="text-sm text-destructive">
            {verifyResult
              ? `Verification failed: ${verifyResult}`
              : "Verification failed. The model may be corrupted."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            {cloudAvailable && (
              <Button variant="ghost" onClick={onCloudFallback}>
                <Cloud className="mr-1.5 size-4" /> Use cloud AI
              </Button>
            )}
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </>
      )}
    </>
  );
}

const STEP_COMPONENT: Record<WizardStep, (props: WizardProps) => React.JSX.Element> = {
  welcome: WelcomeStep,
  "device-check": DeviceCheckStep,
  download: DownloadStep,
  verify: VerifyStep,
};

export function LocalAiSetupWizard(props: WizardProps) {
  const { open, step, onCancel } = props;
  const StepContent = STEP_COMPONENT[step];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <StepContent {...props} />
      </DialogContent>
    </Dialog>
  );
}
