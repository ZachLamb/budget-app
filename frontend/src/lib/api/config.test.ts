/**
 * configApi.get is load-bearing for the login page refactor — it's the
 * one call that decides which auth buttons show. Tests below lock in
 * the call shape + the demo-mode and Google-visibility truthy checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();

vi.mock("./client", () => ({
  default: { get: (...args: unknown[]) => getMock(...args) },
}));

const { configApi } = await import("./config");

beforeEach(() => {
  getMock.mockReset();
});

describe("configApi.get", () => {
  it("calls GET /api/config exactly once per invocation", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        demo_mode: false,
        auth_methods: { password: true, passkey: true, google: true },
      },
    });
    await configApi.get();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/api/config");
  });

  it("returns the parsed AppConfig body", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        demo_mode: true,
        auth_methods: { password: true, passkey: true, google: false },
      },
    });
    const cfg = await configApi.get();
    expect(cfg.demo_mode).toBe(true);
    expect(cfg.auth_methods.google).toBe(false);
    expect(cfg.auth_methods.password).toBe(true);
  });
});
