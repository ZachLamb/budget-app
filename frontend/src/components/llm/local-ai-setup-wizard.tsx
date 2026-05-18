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
import type { WizardProps, WizardStep } from "@/hooks/local-ai-setup-types";

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

function WelcomeStep({
  cloudAvailable,
  onNext,
  onCloudFallback,
}: Pick<WizardProps, "cloudAvailable" | "onNext" | "onCloudFallback">) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Shield className="size-5" /> Set up on-device AI
        </DialogTitle>
        <DialogDescription>
          On-device AI runs entirely in your browser — your data stays local and
          no data leaves your device.
        </DialogDescription>
      </DialogHeader>

      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <Cpu className="mt-0.5 size-4 shrink-0" />
          Runs offline after a one-time download
        </li>
        <li className="flex items-start gap-2">
          <Shield className="mt-0.5 size-4 shrink-0" />
          Private by default — no data leaves your device
        </li>
      </ul>

      <div className="mt-4 flex justify-end gap-2">
        {cloudAvailable && (
          <Button variant="ghost" onClick={onCloudFallback}>
            <Cloud className="mr-1.5 size-4" /> Use cloud AI instead
          </Button>
        )}
        <Button onClick={onNext}>Next</Button>
      </div>
    </>
  );
}

function DeviceCheckStep({
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
  | "modelSize"
  | "freeStorage"
  | "deviceUnsupported"
  | "cloudAvailable"
  | "onGrantConsent"
  | "onCancel"
  | "onCloudFallback"
  | "onToggleLite"
>) {
  if (deviceUnsupported) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-destructive" /> Device check
          </DialogTitle>
          <DialogDescription>
            Local AI is not available on your browser. WebGPU is not supported.
          </DialogDescription>
        </DialogHeader>

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

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <HardDrive className="size-5" /> Device check
        </DialogTitle>
        <DialogDescription>
          We&rsquo;ll download the AI model to your browser storage.
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
  progress,
  progressText,
  downloadError,
  cloudAvailable,
  onRetry,
  onCancel,
  onCloudFallback,
}: Pick<
  WizardProps,
  | "progress"
  | "progressText"
  | "downloadError"
  | "cloudAvailable"
  | "onRetry"
  | "onCancel"
  | "onCloudFallback"
>) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Download className="size-5" /> Downloading model
        </DialogTitle>
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
              <p className="text-center text-xs text-muted-foreground">
                {progressText}
              </p>
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
  verifyStatus,
  verifyResult,
  cloudAvailable,
  onComplete,
  onRetry,
  onCloudFallback,
}: Pick<
  WizardProps,
  | "verifyStatus"
  | "verifyResult"
  | "cloudAvailable"
  | "onComplete"
  | "onRetry"
  | "onCloudFallback"
>) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {verifyStatus === "running" && (
            <Loader2 className="size-5 animate-spin" />
          )}
          {verifyStatus === "success" && (
            <CheckCircle2 className="size-5 text-green-600" />
          )}
          {verifyStatus === "error" && (
            <AlertCircle className="size-5 text-destructive" />
          )}
          {verifyStatus === "idle" && <Cpu className="size-5" />}
          Verification
        </DialogTitle>
      </DialogHeader>

      {verifyStatus === "running" && (
        <p className="text-center text-sm text-muted-foreground">
          Verifying model…
        </p>
      )}

      {verifyStatus === "success" && (
        <>
          <p className="text-sm text-muted-foreground">
            On-device AI is ready.
            {verifyResult && (
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

      {verifyStatus === "error" && (
        <>
          <p className="text-sm text-destructive">
            Verification failed. The model may be corrupted.
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

const STEP_COMPONENT: Record<
  WizardStep,
  (props: WizardProps) => React.JSX.Element
> = {
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
      <DialogContent>
        <StepContent {...props} />
      </DialogContent>
    </Dialog>
  );
}
