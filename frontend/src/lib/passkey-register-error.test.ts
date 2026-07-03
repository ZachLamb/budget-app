import { describe, it, expect } from "vitest";
import { passkeyRegisterErrorAction } from "./passkey-register-error";

describe("passkeyRegisterErrorAction", () => {
  it("routes a 403 (admin approval gate) to the pending-approval flow", () => {
    const err = { response: { status: 403, data: { detail: "Your account is awaiting approval." } } };
    expect(passkeyRegisterErrorAction(err)).toEqual({
      kind: "approval-gate",
      detail: "Your account is awaiting approval.",
    });
  });

  it("falls back to a generic detail when the 403 body has none", () => {
    const action = passkeyRegisterErrorAction({ response: { status: 403 } });
    expect(action.kind).toBe("approval-gate");
  });

  it("treats non-403 errors as ordinary failures", () => {
    expect(passkeyRegisterErrorAction({ response: { status: 500 } })).toEqual({ kind: "other" });
    expect(passkeyRegisterErrorAction(new Error("boom"))).toEqual({ kind: "other" });
  });
});
