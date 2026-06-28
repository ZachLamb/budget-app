import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiUnavailable } from "./ai-unavailable";

vi.mock("@/lib/llm/capability", () => ({
  getCapability: vi.fn(async () => ({
    nano: { available: false, status: "unsupported" },
    webgpu: { available: false, modelSize: "none" },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
  })),
}));

vi.mock("@/lib/llm/storage", () => ({
  getModelDownloadStatus: vi.fn(async () => ({ kind: "unsupported" })),
}));

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    ensureLocalSetup: vi.fn(),
    localSetup: {
      progress: 0,
      open: false,
      step: "welcome",
      setupPath: "none",
      nanoStatus: "unsupported",
      verifyStatus: "idle",
      isDownloading: false,
    },
    aiSettingsPath: "/settings#ai",
  }),
}));

describe("AiUnavailable", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders settings link and requirement panel", async () => {
    render(<AiUnavailable />);
    const outer = document.querySelector('[role="status"][tabindex="0"]');
    expect(outer).not.toBeNull();
    expect(await screen.findByRole("link", { name: /open ai settings/i })).toHaveAttribute(
      "href",
      "/settings#ai",
    );
    expect(await screen.findByText(/browser requirements/i)).toBeInTheDocument();
  });

  it("supports a custom message", () => {
    render(<AiUnavailable message="Goal planning needs a desktop browser." />);
    expect(screen.getByText(/goal planning needs a desktop browser/i)).toBeInTheDocument();
  });
});
