import { describe, expect, it } from "vitest";
import {
  buildOnDeviceRequirements,
  partitionRequirements,
  primaryInAppAction,
} from "./on-device-ai-requirements";

const desktopChrome = {
  label: "Google Chrome",
  isMobile: false,
  isDesktop: true,
  isChromeFamily: true,
};

const baseCap = {
  nano: { available: false, status: "unsupported" as const },
  webgpu: { available: false, modelSize: "none" as const },
  specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
};

describe("buildOnDeviceRequirements", () => {
  it("partitions downloadable Nano into in-app section", () => {
    const reqs = buildOnDeviceRequirements(
      { ...baseCap, nano: { available: true, status: "downloadable" } },
      desktopChrome,
    );
    const { inApp, manual } = partitionRequirements(reqs);
    expect(inApp.some((r) => r.id === "gemini-nano")).toBe(true);
    expect(inApp[0]?.inAppAction).toBe("activate-nano");
    expect(primaryInAppAction(reqs)).toBe("activate-nano");
    expect(manual.some((r) => r.id === "gemini-nano")).toBe(false);
  });

  it("puts unsupported Prompt API in manual section with copy items", () => {
    const reqs = buildOnDeviceRequirements(baseCap, desktopChrome);
    const { manual } = partitionRequirements(reqs);
    const nano = manual.find((r) => r.id === "gemini-nano");
    expect(nano?.fixTier).toBe("browser-manual");
    expect(nano?.manualCopyItems?.length).toBeGreaterThan(0);
  });
});
