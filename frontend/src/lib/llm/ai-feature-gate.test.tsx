import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const decideMock = vi.fn();
const ensureReadyMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/lib/demo-mode", () => ({ isDemoMode: false }));

vi.mock("@/lib/app-toast", () => ({
  appToast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/use-local-ai-setup", () => ({
  useLocalAiSetup: () => ({
    ensureReady: ensureReadyMock,
    wizardProps: {
      open: false,
      step: "welcome",
      modelSize: "3b",
      progress: 0,
      verifyStatus: "idle",
      cloudAvailable: true,
      deviceUnsupported: false,
      onNext: vi.fn(),
      onCancel: vi.fn(),
      onComplete: vi.fn(),
      onRetry: vi.fn(),
      onCloudFallback: vi.fn(),
      onGrantConsent: vi.fn(),
      onToggleLite: vi.fn(),
    },
  }),
}));

vi.mock("@/components/llm/local-ai-setup-wizard", () => ({
  LocalAiSetupWizard: () => null,
}));

vi.mock("@/components/llm/cloud-consent-dialog", () => ({
  CloudConsentDialog: ({
    open,
    onGranted,
  }: {
    open: boolean;
    onGranted: () => void;
  }) =>
    open ? (
      <button type="button" data-testid="grant-cloud" onClick={onGranted}>
        Grant
      </button>
    ) : null,
}));

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    decide: decideMock,
    refresh: refreshMock,
    capability: null,
    getContext: vi.fn(),
    run: vi.fn(),
  }),
}));

const { AiFeatureGateProvider, useAiFeatureGate } = await import("./ai-feature-gate");

function wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(
    QueryClientProvider,
    { client: qc },
    React.createElement(AiFeatureGateProvider, null, children),
  );
}

beforeEach(() => {
  decideMock.mockReset();
  ensureReadyMock.mockReset();
  refreshMock.mockReset();
  ensureReadyMock.mockResolvedValue(undefined);
  refreshMock.mockResolvedValue(undefined);
});

describe("useAiFeatureGate prepareFeature", () => {
  it("returns ready when router decides ready", async () => {
    decideMock.mockResolvedValue({
      kind: "ready",
      tier: 1,
      reason: "ok",
      provider: { name: "nano", tier: 1, privacy: "local", generate: vi.fn() },
    });

    const { result } = renderHook(() => useAiFeatureGate(), { wrapper: wrap });

    let prepared: Awaited<ReturnType<typeof result.current.prepareFeature>>;
    await act(async () => {
      prepared = await result.current.prepareFeature("explain_charge");
    });

    expect(prepared!.ok).toBe(true);
    expect(ensureReadyMock).not.toHaveBeenCalled();
  });

  it("runs on-device setup when download consent is needed", async () => {
    decideMock
      .mockResolvedValueOnce({
        kind: "needs_consent",
        tier: 2,
        reason: "needs_download_consent",
        message: "download",
      })
      .mockResolvedValueOnce({
        kind: "ready",
        tier: 2,
        reason: "ok",
        provider: { name: "web-llm", tier: 2, privacy: "local", generate: vi.fn() },
      });

    const { result } = renderHook(() => useAiFeatureGate(), { wrapper: wrap });

    await act(async () => {
      await result.current.prepareFeature("categorize_transaction");
    });

    expect(ensureReadyMock).toHaveBeenCalledWith("categorize_transaction");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("returns cancelled when user dismisses on-device setup", async () => {
    decideMock.mockResolvedValue({
      kind: "needs_consent",
      tier: 2,
      reason: "needs_download_consent",
      message: "download",
    });
    ensureReadyMock.mockRejectedValue(new Error("User cancelled setup"));

    const { result } = renderHook(() => useAiFeatureGate(), { wrapper: wrap });

    let prepared: Awaited<ReturnType<typeof result.current.prepareFeature>>;
    await act(async () => {
      prepared = await result.current.prepareFeature("categorize_transaction");
    });

    expect(prepared!.ok).toBe(false);
    expect(prepared!.reason).toBe("cancelled");
  });
});

describe("useAiFeatureGate ensureLocalSetup", () => {
  it("delegates to localAi.ensureReady", async () => {
    ensureReadyMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAiFeatureGate(), { wrapper: wrap });

    await act(async () => {
      await result.current.ensureLocalSetup("categorize_transaction");
    });

    expect(ensureReadyMock).toHaveBeenCalledWith("categorize_transaction");
  });

  it("propagates rejection when user cancels", async () => {
    ensureReadyMock.mockRejectedValue(new Error("User cancelled setup"));

    const { result } = renderHook(() => useAiFeatureGate(), { wrapper: wrap });

    await expect(
      act(async () => {
        await result.current.ensureLocalSetup("categorize_transaction");
      }),
    ).rejects.toThrow("User cancelled setup");
  });
});
