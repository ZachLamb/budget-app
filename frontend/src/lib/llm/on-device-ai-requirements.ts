/**
 * Browser requirement checks for on-device AI — derived from capability probes.
 * We cannot read chrome://flags directly; missing APIs imply flags/components
 * the user may need to enable manually in Chrome.
 */

import type { ModelDownloadStatus } from "./storage";
import type { CapabilitySnapshot } from "./types";
import { CHROME_MANUAL_COPY_ITEMS } from "./ai-settings-link";
import {
  detectBrowser,
  getSetupPath,
  type BrowserInfo,
} from "./on-device-ai-guide";

export type RequirementStatus = "pass" | "fail" | "pending" | "optional";

export type RequirementFixTier = "in-app" | "browser-manual" | "none";

export type InAppRequirementAction = "activate-nano" | "download-fallback";

export interface ManualCopyItem {
  label: string;
  value: string;
}

export interface OnDeviceRequirement {
  id: string;
  label: string;
  status: RequirementStatus;
  detail: string;
  /** Action hint when status is fail or pending. */
  action?: string;
  /** Not required for the current best on-device path. */
  optional?: boolean;
  fixTier: RequirementFixTier;
  inAppAction?: InAppRequirementAction;
  manualCopyItems?: ManualCopyItem[];
}

function promptApiPresent(): boolean {
  return (
    typeof (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel !==
    "undefined"
  );
}

function formatStorageGB(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB free`;
}

export function buildOnDeviceRequirements(
  cap: CapabilitySnapshot,
  browser: BrowserInfo = detectBrowser(),
  downloadStatus: ModelDownloadStatus | null = null,
): OnDeviceRequirement[] {
  const path = getSetupPath(cap);
  const nanoPrimary =
    cap.nano.available &&
    (cap.nano.status === "available" ||
      cap.nano.status === "downloadable" ||
      cap.nano.status === "downloading");
  const reqs: OnDeviceRequirement[] = [];

  reqs.push({
    id: "desktop",
    label: "Desktop browser",
    status: browser.isDesktop ? "pass" : "fail",
    detail: browser.isDesktop
      ? "On-device AI runs on a computer, not a phone or tablet."
      : "Open Clarity on a laptop or desktop computer.",
    action: browser.isDesktop ? undefined : PWA_ACTION_DESKTOP,
    fixTier: browser.isDesktop ? "none" : "browser-manual",
  });

  reqs.push({
    id: "chrome-edge",
    label: "Chrome or Edge",
    status: browser.isChromeFamily ? "pass" : "fail",
    detail: browser.isChromeFamily
      ? `Using ${browser.label}.`
      : "On-device AI requires Google Chrome or Microsoft Edge on desktop.",
    action: browser.isChromeFamily
      ? undefined
      : "Install Chrome or Edge, then sign in at the same URL.",
    fixTier: browser.isChromeFamily ? "none" : "browser-manual",
  });

  if (browser.isDesktop && browser.isChromeFamily) {
    reqs.push(buildNanoRequirement(cap));

    const webgpu = buildWebgpuRequirement(cap, nanoPrimary);
    if (webgpu) reqs.push(webgpu);

    const fallback = buildFallbackModelRequirement(cap, path, downloadStatus);
    if (fallback) reqs.push(fallback);
  }

  return reqs;
}

const PWA_ACTION_DESKTOP =
  "You do not need to install Clarity as an app — a normal browser tab on your computer is enough.";

const NANO_FLAG_COPY: ManualCopyItem[] = [
  CHROME_MANUAL_COPY_ITEMS[0],
  CHROME_MANUAL_COPY_ITEMS[1],
  CHROME_MANUAL_COPY_ITEMS[2],
];

const WEBGPU_COPY: ManualCopyItem[] = [CHROME_MANUAL_COPY_ITEMS[3]];

function buildNanoRequirement(cap: CapabilitySnapshot): OnDeviceRequirement {
  const promptApiExists = promptApiPresent();

  switch (cap.nano.status) {
    case "available":
      return {
        id: "gemini-nano",
        label: "Built-in AI (Gemini Nano)",
        status: "pass",
        detail: "Active in this browser — handling AI requests locally.",
        fixTier: "none",
      };
    case "downloadable":
      return {
        id: "gemini-nano",
        label: "Built-in AI (Gemini Nano)",
        status: "pending",
        detail: "Your browser supports built-in AI — activate it with one click below.",
        action: "Chrome downloads its model component; you stay in Clarity.",
        fixTier: "in-app",
        inAppAction: "activate-nano",
      };
    case "downloading":
      return {
        id: "gemini-nano",
        label: "Built-in AI (Gemini Nano)",
        status: "pending",
        detail: "Gemini Nano is downloading — keep this tab open until it finishes.",
        fixTier: "in-app",
        inAppAction: "activate-nano",
      };
    case "unavailable":
      return {
        id: "gemini-nano",
        label: "Built-in AI (Gemini Nano)",
        status: "fail",
        detail: "Built-in AI is not available on this browser build.",
        action:
          "Update Chrome or Edge, then check components and flags below. Clarity cannot change these from the app.",
        fixTier: "browser-manual",
        manualCopyItems: NANO_FLAG_COPY,
      };
    default:
      return {
        id: "gemini-nano",
        label: "Built-in AI (Prompt API)",
        status: "fail",
        detail: promptApiExists
          ? "The Prompt API did not respond — built-in AI may be disabled in Chrome."
          : "The Prompt API is not enabled in this browser.",
        action:
          "Enable the flags below in Chrome, restart the browser, then click Re-check. Clarity cannot toggle flags for you.",
        fixTier: "browser-manual",
        manualCopyItems: NANO_FLAG_COPY,
      };
  }
}

function buildWebgpuRequirement(
  cap: CapabilitySnapshot,
  nanoPrimary: boolean,
): OnDeviceRequirement {
  const sizeLabel = cap.webgpu.modelSize === "1b" ? "~700 MB" : "~1.8 GB";

  if (!cap.webgpu.available) {
    const optional = nanoPrimary;
    return {
      id: "webgpu",
      label: "WebGPU",
      status: optional ? "optional" : "fail",
      detail: optional
        ? "Not required while Gemini Nano is your on-device path."
        : "WebGPU is not available — needed for the fallback on-device model.",
      action: optional
        ? undefined
        : "Check chrome://gpu in Chrome — WebGPU should show “Hardware accelerated”. Clarity cannot enable it from here.",
      fixTier: optional ? "none" : "browser-manual",
      manualCopyItems: optional ? undefined : WEBGPU_COPY,
      optional,
    };
  }

  if (cap.webgpu.modelSize === "none") {
    const optional = nanoPrimary;
    const free = cap.webgpu.storageQuotaBytes;
    return {
      id: "webgpu",
      label: "WebGPU & storage",
      status: optional ? "optional" : "fail",
      detail: optional
        ? "Not required while Gemini Nano is your on-device path."
        : free !== undefined
          ? `WebGPU works, but only ${formatStorageGB(free)} is free — not enough for the ${sizeLabel} fallback model.`
          : `WebGPU works, but there may not be enough browser storage for the ${sizeLabel} fallback model.`,
      action: optional
        ? undefined
        : "Free disk space on this computer, then try the lite model (~700 MB) during setup.",
      fixTier: optional ? "none" : "browser-manual",
      optional,
    };
  }

  const storageNote =
    cap.webgpu.storageQuotaBytes !== undefined
      ? ` (${formatStorageGB(cap.webgpu.storageQuotaBytes)} for ${sizeLabel} fallback)`
      : "";

  return {
    id: "webgpu",
    label: "WebGPU",
    status: "pass",
    detail: nanoPrimary
      ? `Available${storageNote} — optional while Gemini Nano is your on-device path.`
      : `Available${storageNote}.`,
    fixTier: "none",
    optional: nanoPrimary,
  };
}

function buildFallbackModelRequirement(
  cap: CapabilitySnapshot,
  path: ReturnType<typeof getSetupPath>,
  downloadStatus: ModelDownloadStatus | null,
): OnDeviceRequirement | null {
  const showFallbackRow =
    path === "web-llm" ||
    (cap.nano.status !== "available" && cap.webgpu.modelSize !== "none");

  if (!showFallbackRow || !downloadStatus || downloadStatus.kind === "unsupported") {
    return null;
  }

  if (downloadStatus.kind === "downloaded") {
    return {
      id: "fallback-model",
      label: "Fallback model in browser storage",
      status: "pass",
      detail: `Cached locally (${downloadStatus.sizeLabel}).`,
      fixTier: "none",
    };
  }

  return {
    id: "fallback-model",
    label: "Fallback model in browser storage",
    status: "pending",
    detail: `Store a one-time ${downloadStatus.sizeLabel} download in this browser when Gemini Nano is unavailable.`,
    action: "Click below to download — you stay in Clarity.",
    fixTier: "in-app",
    inAppAction: "download-fallback",
  };
}

export function partitionRequirements(reqs: OnDeviceRequirement[]): {
  inApp: OnDeviceRequirement[];
  manual: OnDeviceRequirement[];
  ready: OnDeviceRequirement[];
} {
  const inApp: OnDeviceRequirement[] = [];
  const manual: OnDeviceRequirement[] = [];
  const ready: OnDeviceRequirement[] = [];

  for (const req of reqs) {
    if (req.status === "pass" || (req.status === "optional" && req.optional)) {
      ready.push(req);
      continue;
    }
    if (req.fixTier === "in-app" && req.status !== "pass") {
      inApp.push(req);
    } else if (req.fixTier === "browser-manual" && req.status !== "pass") {
      manual.push(req);
    } else if (req.status === "pending" || req.status === "fail") {
      manual.push(req);
    } else {
      ready.push(req);
    }
  }

  return { inApp, manual, ready };
}

/** Count requirements that block on-device AI (excludes optional rows). */
export function countRequirementIssues(reqs: OnDeviceRequirement[]): number {
  return reqs.filter((r) => !r.optional && (r.status === "fail" || r.status === "pending"))
    .length;
}

export function onDeviceAiReady(
  cap: CapabilitySnapshot,
  downloadStatus: ModelDownloadStatus | null,
): boolean {
  if (cap.nano.status === "available") return true;
  return downloadStatus?.kind === "downloaded";
}

export function primaryInAppAction(
  reqs: OnDeviceRequirement[],
): InAppRequirementAction | null {
  const pending = reqs.find(
    (r) => r.fixTier === "in-app" && r.inAppAction && r.status === "pending",
  );
  return pending?.inAppAction ?? null;
}
