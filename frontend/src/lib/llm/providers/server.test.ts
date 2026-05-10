import { afterEach, describe, it, expect, vi } from "vitest";
import { LLMError, isLLMError, makeServerProvider } from "./server";

/**
 * Build a minimal `Response`-like object for fetch mocks. We use a real
 * `Response` so that `resp.ok`, `resp.status`, and `resp.json()` behave the
 * same way they do in the browser.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("server provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws LLMError with status 429 and the server detail when rate-limited", async () => {
    const detail = "Daily cloud AI limit reached (50). Resets in 24h.";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(429, { detail }));

    const provider = makeServerProvider("explain_charge", () => "test-token");

    let caught: unknown;
    try {
      // The iterator throws on first read since the response is non-2xx.
      for await (const _chunk of provider.generate("hello")) {
        // unreachable
        void _chunk;
      }
    } catch (e) {
      caught = e;
    }

    expect(isLLMError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(LLMError);
    if (isLLMError(caught)) {
      expect(caught.status).toBe(429);
      expect(caught.detail).toBe(detail);
      // Backward-compatible: existing string-only consumers see the detail.
      expect(caught.message).toBe(detail);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws LLMError when the request is unauthenticated by the proxy (401)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, { detail: "Not authenticated" }),
    );

    const provider = makeServerProvider("explain_charge", () => "test-token");

    let caught: unknown;
    try {
      for await (const _chunk of provider.generate("hello")) {
        void _chunk;
      }
    } catch (e) {
      caught = e;
    }

    expect(isLLMError(caught)).toBe(true);
    if (isLLMError(caught)) {
      expect(caught.status).toBe(401);
      expect(caught.detail).toBe("Not authenticated");
    }
  });

  it("falls back to a generic detail when the error body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream timeout", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const provider = makeServerProvider("explain_charge", () => "test-token");

    let caught: unknown;
    try {
      for await (const _chunk of provider.generate("hello")) {
        void _chunk;
      }
    } catch (e) {
      caught = e;
    }

    expect(isLLMError(caught)).toBe(true);
    if (isLLMError(caught)) {
      expect(caught.status).toBe(502);
      expect(caught.detail).toBe("HTTP 502");
    }
  });

  it("throws a plain Error (not LLMError) when no auth token is present", async () => {
    const provider = makeServerProvider("explain_charge", () => null);
    let caught: unknown;
    try {
      for await (const _chunk of provider.generate("hello")) {
        void _chunk;
      }
    } catch (e) {
      caught = e;
    }
    expect(isLLMError(caught)).toBe(false);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Not authenticated.");
  });
});
