import { describe, expect, it } from "vitest";
import {
  detectBrowser,
  getSetupPath,
  nanoSetupSteps,
  unsupportedHeadline,
  unsupportedSteps,
  PWA_NOT_REQUIRED,
  onDeviceAiSettingsIntro,
} from "./on-device-ai-guide";
import type { CapabilitySnapshot } from "./types";

const baseCap: CapabilitySnapshot = {
  webgpu: { available: false, modelSize: "none" },
  nano: { available: false, status: "unavailable" },
  specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
};

describe("on-device-ai-guide", () => {
  it("getSetupPath prefers nano when downloadable", () => {
    expect(
      getSetupPath({
        ...baseCap,
        nano: { available: true, status: "downloadable" },
      }),
    ).toBe("nano");
  });

  it("getSetupPath uses web-llm when nano unavailable but WebGPU has a model", () => {
    expect(
      getSetupPath({
        ...baseCap,
        webgpu: { available: true, modelSize: "3b" },
      }),
    ).toBe("web-llm");
  });

  it("getSetupPath is none when no path exists", () => {
    expect(getSetupPath(baseCap)).toBe("none");
  });

  it("unsupportedHeadline mentions desktop for mobile user agents", () => {
    const browser = detectBrowser();
    const mobile = { ...browser, isMobile: true, isDesktop: false };
    expect(unsupportedHeadline(mobile)).toMatch(/desktop or laptop/i);
  });

  it("unsupportedSteps include PWA clarification", () => {
    const browser = detectBrowser();
    const steps = unsupportedSteps({ ...browser, isMobile: true, isDesktop: false });
    expect(steps.some((s) => s.includes(PWA_NOT_REQUIRED.slice(0, 20)))).toBe(true);
  });

  it("nanoSetupSteps mention setup without requiring app install", () => {
    const joined = nanoSetupSteps().join(" ");
    expect(joined).toMatch(/install/i);
    expect(joined).toMatch(/gemini/i);
  });

  it("active intro says AI is already running in the browser", () => {
    expect(onDeviceAiSettingsIntro("active")).toMatch(/running in this browser tab/i);
    expect(onDeviceAiSettingsIntro("active")).not.toMatch(/download once/i);
  });
});
