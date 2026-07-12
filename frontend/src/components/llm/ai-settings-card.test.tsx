import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiSettingsCard } from "./ai-settings-card";

vi.mock("@/lib/llm/capability", () => ({
  getCapability: vi.fn(),
  _resetCapabilityCache: vi.fn(),
}));
import { getCapability } from "@/lib/llm/capability";

const ensureLocalSetup = vi.fn(async () => {});

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    ensureLocalSetup,
    prepareFeature: vi.fn(async () => ({ ok: true })),
    localSetup: {
      progress: 0,
      open: false,
      step: "welcome",
      setupPath: "nano",
      nanoStatus: "downloadable",
      verifyStatus: "idle",
      isDownloading: false,
    },
    aiSettingsPath: "/settings#ai",
  }),
}));

vi.mock("@/lib/llm/storage", () => ({
  getModelDownloadStatus: vi.fn(async () => ({ kind: "unsupported" })),
  clearModelFromCache: vi.fn(async () => {}),
}));

vi.mock("@/lib/llm/consent", () => ({
  setDownloadModel: vi.fn(),
}));

function renderCard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AiSettingsCard />
    </QueryClientProvider>,
  );
}

const base = {
  webgpu: { available: false, modelSize: "none" as const },
  specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
};

const chromeUa =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("AiSettingsCard — Nano status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: chromeUa,
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows active status when Nano is available", async () => {
    vi.mocked(getCapability).mockResolvedValue({
      ...base,
      nano: { available: true, status: "available" },
    } as never);
    renderCard();
    expect(await screen.findByText(/running in this browser tab/i)).toBeInTheDocument();
    expect(screen.getAllByText(/active in this browser/i).length).toBeGreaterThan(0);
  });

  it("shows in-app activation when Nano is downloadable", async () => {
    vi.mocked(getCapability).mockResolvedValue({
      ...base,
      nano: { available: true, status: "downloadable" },
    } as never);
    renderCard();
    expect(await screen.findByText(/browser requirements/i)).toBeInTheDocument();
    expect(await screen.findByText(/fix in snack's budget/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /activate built-in ai/i }),
    ).toBeInTheDocument();
  });

  it("shows manual Chrome steps when Prompt API is missing", async () => {
    vi.mocked(getCapability).mockResolvedValue({
      ...base,
      nano: { available: false, status: "unsupported" },
    } as never);
    renderCard();
    expect(await screen.findByText(/fix in chrome/i)).toBeInTheDocument();
    expect(screen.getAllByText(/prompt api/i).length).toBeGreaterThan(0);
  });
});
