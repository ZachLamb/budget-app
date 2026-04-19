import { describe, it, expect, vi, beforeEach } from "vitest";

const toastMock = vi.fn();

vi.mock("@/lib/toast-error", () => ({
  toastErrorDiagnostic: (...args: unknown[]) => toastMock(...args),
}));

// Import after the mock so the module picks up the stub.
const { handleMutationError } = await import("./providers");

beforeEach(() => {
  toastMock.mockClear();
});

describe("handleMutationError", () => {
  it("toasts a generic error when the mutation has no onError", () => {
    const err = new Error("boom");
    handleMutationError(err, { options: {} });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toBe("Action failed");
  });

  it("skips the global toast when the mutation has its own onError", () => {
    const err = new Error("boom");
    handleMutationError(err, { options: { onError: () => undefined } });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("skips the global toast for 401s (auth interceptor handles them)", () => {
    const axiosLike = Object.assign(new Error("unauth"), {
      response: { status: 401 },
    });
    handleMutationError(axiosLike, { options: {} });
    expect(toastMock).not.toHaveBeenCalled();
  });
});
