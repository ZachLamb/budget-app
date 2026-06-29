import { describe, expect, it } from "vitest";
import { OnDeviceError, userMessageFor } from "./errors";

describe("OnDeviceError", () => {
  it("carries a code and maps to one user message", () => {
    const e = new OnDeviceError("verify_failed", "numbers did not reconcile");
    expect(e.code).toBe("verify_failed");
    expect(userMessageFor(e)).toMatch(/couldn.t check/i);
  });
  it("maps no_model to a Chrome/Edge hint", () => {
    expect(userMessageFor(new OnDeviceError("no_model", ""))).toMatch(
      /chrome or edge/i,
    );
  });
  it("preserves on-device AI messages from generic Error", () => {
    expect(
      userMessageFor(new Error("On-device AI needs a quick one-time setup.")),
    ).toMatch(/one-time setup/i);
  });
  it("passes through unrelated error messages", () => {
    expect(userMessageFor(new Error("boom"))).toBe("boom");
  });
});
