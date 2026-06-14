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
  it("returns a generic message for non-OnDeviceError values", () => {
    expect(userMessageFor(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
