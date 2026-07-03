import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const prepareFeatureMock = vi.fn();
const runFeatureMock = vi.fn();
const runMock = vi.fn();

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    prepareFeature: prepareFeatureMock,
  }),
}));

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    runFeature: runFeatureMock,
    run: runMock,
  }),
}));

const { useAiPipelineRun } = await import("./use-ai-pipeline-run");

beforeEach(() => {
  prepareFeatureMock.mockReset();
  runFeatureMock.mockReset();
  runMock.mockReset();
  prepareFeatureMock.mockResolvedValue({ ok: true });
  runFeatureMock.mockResolvedValue({ advice: "Save more" });
});

describe("useAiPipelineRun", () => {
  it("runs feature after successful prepare", async () => {
    const { result } = renderHook(() => useAiPipelineRun("financial_advice"));

    let out: { advice: string } | undefined;
    await act(async () => {
      out = await result.current.run({ question: "test" });
    });

    expect(out).toEqual({ advice: "Save more" });
    expect(prepareFeatureMock).toHaveBeenCalledWith("financial_advice");
  });

  it("sets error when prepare is cancelled", async () => {
    prepareFeatureMock.mockResolvedValue({ ok: false, reason: "cancelled" });

    const { result } = renderHook(() => useAiPipelineRun("financial_advice"));

    await act(async () => {
      await expect(result.current.run({})).rejects.toThrow(/cancelled/i);
    });
    expect(result.current.error).toMatch(/cancelled/i);
  });

  it("rejects non-heavy features", async () => {
    const { result } = renderHook(() => useAiPipelineRun("explain_charge"));
    await act(async () => {
      await expect(result.current.run({})).rejects.toThrow(/heavy pipeline/i);
    });
  });
});
