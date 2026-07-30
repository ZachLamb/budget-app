import { describe, it, expect, vi, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { postToBackend, upstreamErrorResponse } from "./ai-proxy";

/** Minimal NextRequest stand-in: the proxy only reads `headers` and `signal`. */
function fakeReq(opts: { signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  return {
    headers: new Headers(opts.headers ?? {}),
    signal: opts.signal ?? new AbortController().signal,
  } as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upstreamErrorResponse", () => {
  it("reports a cancelled request when the client hung up", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = upstreamErrorResponse(fakeReq({ signal: ac.signal }), new Error("aborted"));

    expect(res.status).toBe(499);
    await expect(res.json()).resolves.toEqual({ detail: "Request cancelled." });
  });

  it("reports a gateway timeout when the upstream deadline fired", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const res = upstreamErrorResponse(fakeReq(), timeout);

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toEqual({
      detail: "The AI backend took too long to respond.",
    });
  });

  it("reports a bad gateway for an unreachable backend", async () => {
    const res = upstreamErrorResponse(fakeReq(), new TypeError("fetch failed"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ detail: "Could not reach the AI backend." });
  });
});

describe("postToBackend", () => {
  it("returns parseable JSON instead of throwing when the backend is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const result = await postToBackend("/api/llm/cloud", fakeReq(), { a: 1 }, {
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(502);
    await expect(result.response.json()).resolves.toHaveProperty("detail");
  });

  it("passes the upstream response through on success", async () => {
    const upstream = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));

    const result = await postToBackend("/api/ai/prepare-action", fakeReq(), {}, {
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.upstream).toBe(upstream);
  });

  it("aborts the upstream request when the client aborts", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ac = new AbortController();
    const pending = postToBackend("/api/llm/cloud", fakeReq({ signal: ac.signal }), {}, {
      timeoutMs: 60_000,
    });
    ac.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(499);
  });

  it("forwards Cookie and Origin so the backend sees an authenticated request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postToBackend(
      "/api/ai/execute-action",
      fakeReq({ headers: { Cookie: "session=abc", Origin: "https://app.example" } }),
      {},
      { timeoutMs: 1000 },
    );

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({
      Cookie: "session=abc",
      Origin: "https://app.example",
    });
  });
});
