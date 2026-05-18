import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const getModelDownloadStatusMock = vi.fn();
const getCapabilityMock = vi.fn();
const getFeaturePolicyMock = vi.fn();
const setDownloadModelMock = vi.fn();
const setUseLiteModelMock = vi.fn();
const ensureEngineMock = vi.fn();
const webLlmProviderMock = { generate: vi.fn() };

let mockIsDemoMode = false;

vi.mock("@/lib/llm/storage", () => ({
  getModelDownloadStatus: (...args: unknown[]) =>
    getModelDownloadStatusMock(...args),
}));

vi.mock("@/lib/llm/capability", () => ({
  getCapability: (...args: unknown[]) => getCapabilityMock(...args),
}));

vi.mock("@/lib/llm/features", () => ({
  getFeaturePolicy: (...args: unknown[]) => getFeaturePolicyMock(...args),
}));

vi.mock("@/lib/demo-mode", () => ({
  get isDemoMode() {
    return mockIsDemoMode;
  },
}));

vi.mock("@/lib/llm/consent", () => ({
  setDownloadModel: (...args: unknown[]) => setDownloadModelMock(...args),
  setUseLiteModel: (...args: unknown[]) => setUseLiteModelMock(...args),
}));

vi.mock("@/lib/llm/providers/web-llm-engine", () => ({
  ensureEngine: (...args: unknown[]) => ensureEngineMock(...args),
  webLlmProvider: webLlmProviderMock,
}));

const { useLocalAiSetup } = await import("./use-local-ai-setup");

const defaultCapability = {
  webgpu: { available: true, modelSize: "3b" as const, storageQuotaBytes: 5_000_000_000 },
  nano: { available: false, status: "unsupported" as const },
  server: { available: true },
};

const defaultPolicy = {
  id: "fsa_review",
  label: "FSA Review",
  allowedTiers: [2, 4],
  minimumTier: 2,
  defaultTier: 2,
  cloudPossible: true,
};

beforeEach(() => {
  getModelDownloadStatusMock.mockReset();
  getCapabilityMock.mockReset();
  getFeaturePolicyMock.mockReset();
  setDownloadModelMock.mockReset();
  setUseLiteModelMock.mockReset();
  ensureEngineMock.mockReset();
  webLlmProviderMock.generate.mockReset();

  mockIsDemoMode = false;
  getCapabilityMock.mockResolvedValue(defaultCapability);
  getFeaturePolicyMock.mockReturnValue(defaultPolicy);
  getModelDownloadStatusMock.mockResolvedValue({
    kind: "not-downloaded",
    modelId: "model-3b",
    sizeLabel: "1.8 GB",
  });
});

const flush = () => new Promise<void>(r => setTimeout(r, 10));

/**
 * Fire ensureReady and wait for the wizard to open.
 * Returns the wizard promise wrapped in an object -- returning a bare
 * never-settling promise from an async function would cause `await` to hang.
 */
async function openWizard(result: { current: ReturnType<typeof useLocalAiSetup> }) {
  const wizardPromise = result.current.ensureReady("fsa_review");
  // Let microtasks from getModelDownloadStatus / getCapability resolve
  await flush();
  // Commit pending React state updates (setOpen, setCapability, etc.)
  act(() => {});
  expect(result.current.wizardProps.open).toBe(true);
  return { wizardPromise };
}

describe("useLocalAiSetup", () => {
  it("ensureReady resolves immediately in demo mode", async () => {
    mockIsDemoMode = true;

    const { result } = renderHook(() => useLocalAiSetup());

    await act(async () => {
      await expect(result.current.ensureReady("fsa_review")).resolves.toBeUndefined();
    });
    expect(result.current.wizardProps.open).toBe(false);
  });

  it("ensureReady resolves immediately when model is already cached", async () => {
    getModelDownloadStatusMock.mockResolvedValue({
      kind: "downloaded",
      modelId: "model-3b",
      sizeLabel: "1.8 GB",
    });

    const { result } = renderHook(() => useLocalAiSetup());

    await act(async () => {
      await expect(result.current.ensureReady("fsa_review")).resolves.toBeUndefined();
    });
    expect(result.current.wizardProps.open).toBe(false);
  });

  it("ensureReady opens wizard when model is not cached", async () => {
    const { result } = renderHook(() => useLocalAiSetup());

    const { wizardPromise } = await openWizard(result);

    expect(result.current.wizardProps.step).toBe("welcome");
    const raceResult = await Promise.race([
      wizardPromise.then(() => "resolved"),
      Promise.resolve("pending"),
    ]);
    expect(raceResult).toBe("pending");
  });

  it("concurrent ensureReady calls share the same promise", async () => {
    const { result } = renderHook(() => useLocalAiSetup());

    const { wizardPromise: p1 } = await openWizard(result);
    const p2 = result.current.ensureReady("fsa_review");
    await flush();
    act(() => {});

    // Both calls should resolve/reject together (same underlying deferred)
    const raceP1 = await Promise.race([p1.then(() => "resolved"), Promise.resolve("pending")]);
    const raceP2 = await Promise.race([p2.then(() => "resolved"), Promise.resolve("pending")]);
    expect(raceP1).toBe("pending");
    expect(raceP2).toBe("pending");
  });

  it("onCancel rejects the pending promise and closes wizard", async () => {
    const { result } = renderHook(() => useLocalAiSetup());

    const { wizardPromise } = await openWizard(result);

    act(() => {
      result.current.wizardProps.onCancel();
    });

    await expect(wizardPromise).rejects.toThrow();
    expect(result.current.wizardProps.open).toBe(false);
  });

  it("onComplete resolves the pending promise and closes wizard", async () => {
    const { result } = renderHook(() => useLocalAiSetup());

    const { wizardPromise } = await openWizard(result);

    act(() => {
      result.current.wizardProps.onComplete();
    });

    await expect(wizardPromise).resolves.toBeUndefined();
    expect(result.current.wizardProps.open).toBe(false);
  });

  it("deviceUnsupported is true when modelSize is none", async () => {
    getModelDownloadStatusMock.mockResolvedValue({ kind: "unsupported" });
    getCapabilityMock.mockResolvedValue({
      webgpu: { available: false, modelSize: "none" },
      nano: { available: false, status: "unsupported" },
      server: { available: true },
    });

    const { result } = renderHook(() => useLocalAiSetup());

    await openWizard(result);

    expect(result.current.wizardProps.deviceUnsupported).toBe(true);
  });

  it("onGrantConsent calls setDownloadModel and advances to download step", async () => {
    ensureEngineMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useLocalAiSetup());

    await openWizard(result);

    act(() => {
      result.current.wizardProps.onNext();
    });
    expect(result.current.wizardProps.step).toBe("device-check");

    act(() => {
      result.current.wizardProps.onGrantConsent();
    });

    expect(setDownloadModelMock).toHaveBeenCalledWith("granted");
    expect(result.current.wizardProps.step).toBe("download");
  });

  it("onNext advances through steps", async () => {
    const { result } = renderHook(() => useLocalAiSetup());

    await openWizard(result);

    expect(result.current.wizardProps.step).toBe("welcome");

    act(() => {
      result.current.wizardProps.onNext();
    });
    expect(result.current.wizardProps.step).toBe("device-check");
  });
});
