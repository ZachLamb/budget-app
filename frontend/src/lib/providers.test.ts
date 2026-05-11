import { describe, it, expect, vi, beforeEach } from "vitest";

const toastMock = vi.fn();

vi.mock("@/lib/toast-error", () => ({
  toastErrorDiagnostic: (...args: unknown[]) => toastMock(...args),
}));

// Import after the mock so the module picks up the stub.
const { handleMutationError, queryRetry, queryRetryDelay } = await import("./providers");

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

describe("queryRetry", () => {
  // Builder for axios-shaped errors so the test reads like the real call site.
  const httpError = (status: number) => Object.assign(new Error("http"), { response: { status } });
  const networkError = () => Object.assign(new Error("ECONNRESET"));

  it("retries 5xx up to 3 times then stops (covers Fly cold-start window)", () => {
    const err = httpError(500);
    expect(queryRetry(0, err)).toBe(true);
    expect(queryRetry(1, err)).toBe(true);
    expect(queryRetry(2, err)).toBe(true);
    expect(queryRetry(3, err)).toBe(false);
  });

  it("retries 502/503/504 (typical Vercel-edge proxy errors during backend wake-up)", () => {
    expect(queryRetry(0, httpError(502))).toBe(true);
    expect(queryRetry(0, httpError(503))).toBe(true);
    expect(queryRetry(0, httpError(504))).toBe(true);
  });

  it("retries network errors (no response object at all)", () => {
    expect(queryRetry(0, networkError())).toBe(true);
    expect(queryRetry(2, networkError())).toBe(true);
    expect(queryRetry(3, networkError())).toBe(false);
  });

  it("does NOT retry 4xx — they won't succeed on retry", () => {
    expect(queryRetry(0, httpError(400))).toBe(false);
    expect(queryRetry(0, httpError(401))).toBe(false);
    expect(queryRetry(0, httpError(403))).toBe(false);
    expect(queryRetry(0, httpError(404))).toBe(false);
    expect(queryRetry(0, httpError(422))).toBe(false);
  });
});

describe("queryRetryDelay", () => {
  it("backs off exponentially: 1s, 2s, 4s, capped at 8s", () => {
    expect(queryRetryDelay(0)).toBe(1000);
    expect(queryRetryDelay(1)).toBe(2000);
    expect(queryRetryDelay(2)).toBe(4000);
    expect(queryRetryDelay(3)).toBe(8000); // hits cap
    expect(queryRetryDelay(10)).toBe(8000); // still capped
  });
});
