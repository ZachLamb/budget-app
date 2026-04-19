/**
 * Behavior of the shared axios `client.ts`: URL normalization, auth header
 * injection, and the error-mapping interceptor. These are the routes every
 * API call goes through — quiet regressions here silently break authed
 * queries or mask server errors.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

import api, { handleResponseError } from "./client";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Run the request interceptor chain without actually firing a request. */
async function runRequestInterceptors(
  config: AxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> {
  // axios.interceptors.request.handlers is private but documented API surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (api.interceptors.request as any).handlers.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (h: any) => h && h.fulfilled,
  );
  let current = { headers: {}, ...config } as InternalAxiosRequestConfig;
   
  for (const h of chain) current = await h.fulfilled(current);
  return current;
}

/** Invoke the exported interceptor directly — no axios-internal traversal. */
async function runErrorInterceptor(err: Partial<AxiosError>) {
  try {
    return await handleResponseError(err);
  } catch (e) {
    return e as AxiosError;
  }
}

describe("client request interceptor", () => {
  it("rewrites absolute URLs to the /api/... relative path on the client", async () => {
    const out = await runRequestInterceptors({
      url: "https://backend.internal:8000/api/accounts",
      method: "get",
    });
    expect(out.url).toBe("/api/accounts");
  });

  it("prefixes bare paths with /api", async () => {
    const out = await runRequestInterceptors({ url: "/accounts", method: "get" });
    expect(out.url).toBe("/api/accounts");
  });

  it("leaves already-prefixed /api URLs alone", async () => {
    const out = await runRequestInterceptors({ url: "/api/transactions", method: "get" });
    expect(out.url).toBe("/api/transactions");
  });

  it("attaches Authorization: Bearer <token> when a token is in localStorage", async () => {
    localStorage.setItem("token", "abc123");
    const out = await runRequestInterceptors({ url: "/api/me", method: "get" });
    expect(out.headers.Authorization).toBe("Bearer abc123");
  });

  it("omits Authorization when no token is present", async () => {
    const out = await runRequestInterceptors({ url: "/api/health", method: "get" });
    expect(out.headers.Authorization).toBeUndefined();
  });
});

describe("client response interceptor", () => {
  it("clears the stored token and redirects to /login on 401", async () => {
    localStorage.setItem("token", "abc");
    localStorage.setItem("user", JSON.stringify({ id: "u1" }));

    // jsdom intentionally does NOT navigate when window.location.href is
    // assigned — we replace the href setter so we can observe the intent.
    const original = window.location;
    let redirected = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        set href(v: string) {
          redirected = v;
        },
        get href() {
          return redirected;
        },
      },
    });

    try {
      const err = { response: { status: 401, data: {} } } as Partial<AxiosError>;
      await runErrorInterceptor(err);
      expect(localStorage.getItem("token")).toBeNull();
      expect(localStorage.getItem("user")).toBeNull();
      expect(redirected).toBe("/login");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("maps ECONNABORTED to a user-friendly timeout message", async () => {
    const err = { code: "ECONNABORTED", message: "timeout of 30000ms exceeded" } as Partial<AxiosError>;
    const rejected = (await runErrorInterceptor(err)) as AxiosError;
    expect(rejected.message).toMatch(/timed out/i);
  });

  it("maps ERR_CANCELED to 'Request canceled.' (not 'timed out')", async () => {
    const err = { code: "ERR_CANCELED", message: "canceled" } as Partial<AxiosError>;
    const rejected = (await runErrorInterceptor(err)) as AxiosError;
    expect(rejected.message).toBe("Request canceled.");
  });

  it("surfaces string detail from the server as err.message", async () => {
    const err = {
      response: { status: 400, data: { detail: "Email already in use" } },
      message: "Request failed with status code 400",
    } as Partial<AxiosError>;
    const rejected = (await runErrorInterceptor(err)) as AxiosError;
    expect(rejected.message).toBe("Email already in use");
  });

  it("JSON-stringifies non-string detail so it reaches the toast in some form", async () => {
    const err = {
      response: {
        status: 422,
        data: {
          detail: [{ loc: ["body", "email"], msg: "value is not a valid email" }],
        },
      },
      message: "Request failed with status code 422",
    } as Partial<AxiosError>;
    const rejected = (await runErrorInterceptor(err)) as AxiosError;
    expect(rejected.message).toContain("value is not a valid email");
  });
});
