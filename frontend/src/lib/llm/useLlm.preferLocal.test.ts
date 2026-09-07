import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const getAiSettingsMock = vi.fn();
const streamCloudGenerateMock = vi.fn();
const routerDecideMock = vi.fn();
const getCapabilityMock = vi.fn();

vi.mock("@/lib/hooks", () => ({ useDemoGuard: () => ({ isDemo: false }) }));

vi.mock("@/lib/api/settings", () => ({
  settingsApi: {
    getAiSettings: (...args: unknown[]) => getAiSettingsMock(...args),
  },
}));

vi.mock("./providers/cloud", () => ({
  streamCloudGenerate: (...args: unknown[]) => streamCloudGenerateMock(...args),
}));

vi.mock("./router", () => ({
  decide: (...args: unknown[]) => routerDecideMock(...args),
}));

vi.mock("./capability", () => ({
  getCapability: (...args: unknown[]) => getCapabilityMock(...args),
}));

vi.mock("./providers/nano", () => ({ nanoProvider: { name: "nano", tier: 1 } }));
vi.mock("./providers/web-llm", () => ({ getWebLlmProvider: vi.fn() }));
vi.mock("./cascade", () => ({ resolveCascadeProviders: vi.fn() }));

const { useLlm } = await import("./useLlm");

let qc: QueryClient;

function wrap({ children }: { children: React.ReactNode }) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of iter) out += chunk;
  return out;
}

beforeEach(() => {
  getAiSettingsMock.mockReset();
  streamCloudGenerateMock.mockReset();
  routerDecideMock.mockReset();
  getCapabilityMock.mockReset();
  getCapabilityMock.mockResolvedValue({
    nano: { available: true, status: "available" },
    webgpu: { available: false, modelSize: "none" },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
  });
});

describe("useLlm.run — local-server-first for light features", () => {
  it("tries the local server first when prefer_local_server is on", async () => {
    getAiSettingsMock.mockResolvedValue({ ai_enabled: true, prefer_local_server: true });
    streamCloudGenerateMock.mockResolvedValue("from local server");

    const { result } = renderHook(() => useLlm(), { wrapper: wrap });
    await waitFor(() => expect(qc.getQueryData(["aiSettings"])).toBeDefined());

    const text = await act(() => collect(result.current.run("explain_charge", "why?")));

    expect(text).toBe("from local server");
    expect(streamCloudGenerateMock).toHaveBeenCalledTimes(1);
    expect(routerDecideMock).not.toHaveBeenCalled();
  });

  it("falls back to the on-device router when the local server fails", async () => {
    getAiSettingsMock.mockResolvedValue({ ai_enabled: true, prefer_local_server: true });
    streamCloudGenerateMock.mockRejectedValue(new Error("connection refused"));
    routerDecideMock.mockResolvedValue({
      kind: "ready",
      tier: 1,
      reason: "ok",
      provider: {
        name: "nano",
        tier: 1,
        privacy: "local",
        generate: async function* () {
          yield "on-device";
        },
      },
    });

    const { result } = renderHook(() => useLlm(), { wrapper: wrap });
    await waitFor(() => expect(qc.getQueryData(["aiSettings"])).toBeDefined());

    const text = await act(() => collect(result.current.run("explain_charge", "why?")));

    expect(streamCloudGenerateMock).toHaveBeenCalledTimes(1);
    expect(routerDecideMock).toHaveBeenCalledTimes(1);
    expect(text).toBe("on-device");
  });

  it("skips the local server entirely when prefer_local_server is off", async () => {
    getAiSettingsMock.mockResolvedValue({ ai_enabled: true, prefer_local_server: false });
    routerDecideMock.mockResolvedValue({
      kind: "ready",
      tier: 1,
      reason: "ok",
      provider: {
        name: "nano",
        tier: 1,
        privacy: "local",
        generate: async function* () {
          yield "on-device";
        },
      },
    });

    const { result } = renderHook(() => useLlm(), { wrapper: wrap });
    await waitFor(() => expect(qc.getQueryData(["aiSettings"])).toBeDefined());

    const text = await act(() => collect(result.current.run("explain_charge", "why?")));

    expect(streamCloudGenerateMock).not.toHaveBeenCalled();
    expect(routerDecideMock).toHaveBeenCalledTimes(1);
    expect(text).toBe("on-device");
  });
});
