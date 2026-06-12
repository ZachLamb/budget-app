/**
 * Behavior of the shared axios `client.ts`: URL normalization, auth header
 * injection, and the error-mapping interceptor. These are the routes every
 * API call goes through — quiet regressions here silently break authed
 * queries or mask server errors.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

import api, { handleResponseError, formatErrorDetail } from "./client";

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

  it("does not attach Authorization from localStorage (session is cookie-only)", async () => {
    localStorage.setItem("token", "abc123");
    const out = await runRequestInterceptors({ url: "/api/me", method: "get" });
    expect(out.headers.Authorization).toBeUndefined();
  });

  it("omits Authorization when no legacy token is present", async () => {
    const out = await runRequestInterceptors({ url: "/api/health", method: "get" });
    expect(out.headers.Authorization).toBeUndefined();
  });
});

describe("client response interceptor", () => {
  /**
   * Stub window.location so we can read .pathname (where the user "is") and
   * observe href assignments (where the interceptor would navigate to) without
   * jsdom doing an actual navigation.
   */
  function stubLocation(pathname: string): { getRedirect: () => string; restore: () => void } {
    const original = window.location;
    let redirected = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        pathname,
        set href(v: string) {
          redirected = v;
        },
        get href() {
          return redirected;
        },
      },
    });
    return {
      getRedirect: () => redirected,
      restore: () => {
        Object.defineProperty(window, "location", { configurable: true, value: original });
      },
    };
  }

  it("clears the stored token and redirects to /login on 401 from an authed page", async () => {
    localStorage.setItem("token", "abc");
    localStorage.setItem("user", JSON.stringify({ id: "u1" }));

    const loc = stubLocation("/transactions");
    try {
      const err = { response: { status: 401, data: {} } } as Partial<AxiosError>;
      await runErrorInterceptor(err);
      expect(localStorage.getItem("token")).toBeNull();
      expect(localStorage.getItem("user")).toBeNull();
      expect(loc.getRedirect()).toBe("/login");
    } finally {
      loc.restore();
    }
  });

  it("does NOT redirect on 401 when already on /login (prevents refresh loop)", async () => {
    // Before this guard: AuthProvider mounts on /login → calls /auth/me →
    // 401 (no session) → interceptor sets window.location.href = "/login"
    // → page reloads → AuthProvider mounts again → repeat forever.
    const loc = stubLocation("/login");
    try {
      const err = { response: { status: 401, data: {} } } as Partial<AxiosError>;
      await runErrorInterceptor(err);
      expect(loc.getRedirect()).toBe("");
    } finally {
      loc.restore();
    }
  });

  it("redirects on 401 from /register (route no longer exists, not an auth entry point)", async () => {
    const loc = stubLocation("/register");
    try {
      const err = { response: { status: 401, data: {} } } as Partial<AxiosError>;
      await runErrorInterceptor(err);
      expect(loc.getRedirect()).toBe("/login");
    } finally {
      loc.restore();
    }
  });

  it("does NOT redirect on 401 when on /auth/magic-link", async () => {
    // The magic-link verify page handles its own 401 (failed-redeem) UI; an
    // interceptor redirect would yank the user to /login mid-error-render.
    const loc = stubLocation("/auth/magic-link");
    try {
      const err = { response: { status: 401, data: {} } } as Partial<AxiosError>;
      await runErrorInterceptor(err);
      expect(loc.getRedirect()).toBe("");
    } finally {
      loc.restore();
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

  it("formats FastAPI validation arrays into a readable field message", async () => {
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
    expect(rejected.message).toBe("email: value is not a valid email");
  });
});

describe("formatErrorDetail", () => {
  it("passes strings through unchanged", () => {
    expect(formatErrorDetail("Nope")).toBe("Nope");
  });

  it("joins multiple validation errors and caps at three", () => {
    const detail = [
      { loc: ["body", "name"], msg: "field required" },
      { loc: ["body", "amount"], msg: "must be a number" },
      { loc: ["body", "date"], msg: "invalid date" },
      { loc: ["body", "extra"], msg: "should not appear" },
    ];
    const msg = formatErrorDetail(detail);
    expect(msg).toBe(
      "name: field required; amount: must be a number; date: invalid date",
    );
  });

  it("handles nested field locations", () => {
    expect(
      formatErrorDetail([{ loc: ["body", "items", 0, "amount"], msg: "required" }]),
    ).toBe("items.0.amount: required");
  });

  it("never dumps raw JSON for unknown shapes", () => {
    expect(formatErrorDetail({ some: { nested: "thing" } })).toBe(
      "Request failed. Please check your input and try again.",
    );
    expect(formatErrorDetail(42)).toBe(
      "Request failed. Please check your input and try again.",
    );
  });
});
