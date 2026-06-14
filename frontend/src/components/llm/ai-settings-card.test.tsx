import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiSettingsCard } from "./ai-settings-card";

vi.mock("@/lib/llm/capability", () => ({
  getCapability: vi.fn(),
  _resetCapabilityCache: vi.fn(),
}));
import { getCapability } from "@/lib/llm/capability";

// The card opens the setup wizard via the gate; stub it so we can render in
// isolation and assert the Nano setup button calls into the hook entry.
const ensureLocalSetup = vi.fn(async () => {});
vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    ensureLocalSetup,
    prepareFeature: vi.fn(async () => ({ ok: true })),
  }),
}));

// Storage probe (web-llm cache) — default to "no fallback model downloaded".
vi.mock("@/lib/llm/storage", () => ({
  getModelDownloadStatus: vi.fn(async () => ({ kind: "unsupported" })),
  clearModelFromCache: vi.fn(async () => {}),
}));

vi.mock("@/lib/llm/consent", () => ({
  setDownloadModel: vi.fn(),
}));

vi.mock("@/lib/api/llm", () => ({
  llmApi: {
    listCloudConsent: vi.fn(async () => []),
    grantCloudConsent: vi.fn(async () => ({})),
    revokeAllCloudConsent: vi.fn(async () => ({})),
  },
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
  server: { available: true },
  specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
};

describe("AiSettingsCard — Nano status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'On-device AI ready' when Nano is available", async () => {
    vi.mocked(getCapability).mockResolvedValue({
      ...base,
      nano: { available: true, status: "available" },
    } as never);
    renderCard();
    expect(await screen.findByText(/on-device ai ready/i)).toBeInTheDocument();
  });

  it("shows a setup button when Nano is downloadable", async () => {
    vi.mocked(getCapability).mockResolvedValue({
      ...base,
      nano: { available: true, status: "downloadable" },
    } as never);
    renderCard();
    expect(await screen.findByText(/setting up on-device ai/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set up on-device ai/i }),
    ).toBeInTheDocument();
  });

  it("shows a Chrome/Edge hint when nothing is available", async () => {
    vi.mocked(getCapability).mockResolvedValue({
      ...base,
      nano: { available: false, status: "unsupported" },
    } as never);
    renderCard();
    expect(
      await screen.findByText(/chrome or edge on desktop/i),
    ).toBeInTheDocument();
  });
});
