/**
 * Shared copy and browser detection for on-device AI setup UX.
 * Keeps Settings, the setup wizard, and feature gates aligned.
 */

import type { CapabilitySnapshot } from "./types";

export type OnDeviceSetupPath = "nano" | "web-llm" | "none";

export interface BrowserInfo {
  label: string;
  isMobile: boolean;
  isDesktop: boolean;
  isChromeFamily: boolean;
}

/** Installing as a PWA is optional — on-device AI runs in a normal tab. */
export const PWA_NOT_REQUIRED =
  "You do not need to install Snack's Budget as an app. Open it in a regular browser tab on your computer.";

export function detectBrowser(): BrowserInfo {
  if (typeof navigator === "undefined") {
    return { label: "your browser", isMobile: false, isDesktop: true, isChromeFamily: false };
  }
  const ua = navigator.userAgent;
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const isEdge = /Edg\//.test(ua);
  const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);

  let label = "your browser";
  if (isEdge) label = "Microsoft Edge";
  else if (isChrome) label = "Google Chrome";
  else if (isFirefox) label = "Firefox";
  else if (isSafari) label = "Safari";

  return {
    label,
    isMobile,
    isDesktop: !isMobile,
    isChromeFamily: isChrome || isEdge,
  };
}

/** Which on-device path this device can use (before download consent). */
export function getSetupPath(cap: CapabilitySnapshot): OnDeviceSetupPath {
  if (cap.nano.available && cap.nano.status !== "unavailable") return "nano";
  if (cap.webgpu.available && cap.webgpu.modelSize !== "none") return "web-llm";
  return "none";
}

export function unsupportedHeadline(browser: BrowserInfo): string {
  if (browser.isMobile) {
    return "On-device AI needs a desktop or laptop browser";
  }
  if (!browser.isChromeFamily) {
    return "On-device AI needs Chrome or Edge on desktop";
  }
  return "On-device AI is not available in this browser yet";
}

/** Numbered steps when no on-device path is available. */
export function unsupportedSteps(browser: BrowserInfo): string[] {
  if (browser.isMobile) {
    return [
      "On a computer, open Snack's Budget in Google Chrome or Microsoft Edge (not your phone or tablet).",
      PWA_NOT_REQUIRED,
      "In the app, go to Settings → enable AI Financial Advisor → Set up on-device AI.",
      "Return to Transactions or AI Advisor and try your suggestion again.",
    ];
  }
  if (!browser.isChromeFamily) {
    return [
      "Install or open Google Chrome or Microsoft Edge on this computer.",
      "Sign in to Snack's Budget at the same URL you use today (a normal tab is fine — no app install).",
      "Go to Settings → enable AI Financial Advisor → Set up on-device AI.",
      "Try your AI feature again after setup finishes.",
    ];
  }
  return [
    "Update Chrome or Edge to the latest version.",
    "Visit chrome://flags and ensure on-device AI / Prompt API features are enabled if your build supports them.",
    "Check chrome://gpu — WebGPU should show “Hardware accelerated” when using the fallback model path.",
    "Go to Settings → Set up on-device AI, then retry.",
  ];
}

/** Steps for Gemini Nano (built into Chrome/Edge). */
export function nanoSetupSteps(): string[] {
  return [
    "Use Google Chrome or Microsoft Edge on a desktop or laptop (" + PWA_NOT_REQUIRED.toLowerCase() + ").",
    "Click Set up on-device AI — Chrome downloads Gemini Nano once (usually a few minutes).",
    "Keep this tab open until the progress bar completes.",
    "When you see “On-device AI is ready”, try AI suggestions again.",
  ];
}

/** Steps for the WebGPU fallback model download. */
export function webLlmSetupSteps(sizeLabel: string): string[] {
  return [
    "Use Chrome or Edge on a desktop or laptop with WebGPU enabled (see chrome://gpu).",
    `Confirm you have about ${sizeLabel} free disk space for the one-time model download.`,
    "Click Download and wait — this can take several minutes on slower connections.",
    "After verification succeeds, AI features that need the fallback model will work offline.",
  ];
}

export const WIZARD_STEPS = [
  { id: "welcome", label: "Overview" },
  { id: "device-check", label: "Device check" },
  { id: "download", label: "Download" },
  { id: "verify", label: "Verify" },
] as const;

export type OnDeviceAiSettingsPhase =
  | "active"
  | "nano-setup"
  | "fallback-setup"
  | "unsupported"
  | "loading";

/** Card-level intro copy — avoids implying Snack's Budget is something you install. */
export function onDeviceAiSettingsIntro(phase: OnDeviceAiSettingsPhase): string {
  switch (phase) {
    case "active":
      return "Running in this browser tab. Your browser's built-in AI handles requests locally — nothing extra to install in Snack's Budget.";
    case "nano-setup":
      return "Your browser supports built-in AI. Finish the one-time activation below — Chrome or Edge downloads its model component, not a separate Snack's Budget app.";
    case "fallback-setup":
      return "Built-in AI isn't available here. You can store a fallback model in your browser for offline use (one-time download).";
    case "unsupported":
      return "This browser or device can't run on-device AI yet. Review the checklist below — no Snack's Budget app install is required.";
    default:
      return "Checking what your browser supports…";
  }
}

export function resolveOnDeviceAiSettingsPhase(input: {
  cap: CapabilitySnapshot | null;
  deviceReady: boolean;
  nanoSetupPending: boolean;
  webLlmFallbackUsable: boolean;
  isModelDownloaded: boolean;
  noOnDeviceOption: boolean;
}): OnDeviceAiSettingsPhase {
  if (input.cap === null) return "loading";
  if (input.deviceReady) return "active";
  if (input.nanoSetupPending) return "nano-setup";
  if (input.webLlmFallbackUsable && !input.isModelDownloaded) return "fallback-setup";
  if (input.noOnDeviceOption) return "unsupported";
  return "loading";
}
