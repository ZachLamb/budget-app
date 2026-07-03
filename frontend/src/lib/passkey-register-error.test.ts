import { describe, it, expect } from "vitest";
import { passkeyRegisterErrorAction } from "./passkey-register-error";

const PENDING_DETAIL =
  "Your account is awaiting approval by an administrator. You'll be able to sign in once it's approved.";
const REJECTED_DETAIL =
  "Your account has been denied access. Contact the administrator.";
const DEMO_DETAIL = "This is a read-only demo. Sign-ups are disabled.";

describe("passkeyRegisterErrorAction", () => {
  it("routes a 403 with pending-approval detail to the approval-gate", () => {
    const err = { response: { status: 403, data: { detail: PENDING_DETAIL } } };
    expect(passkeyRegisterErrorAction(err)).toEqual({
      kind: "approval-gate",
      detail: PENDING_DETAIL,
    });
  });

  it("routes a 403 with denied-access detail to the approval-gate", () => {
    const err = { response: { status: 403, data: { detail: REJECTED_DETAIL } } };
    expect(passkeyRegisterErrorAction(err)).toEqual({
      kind: "approval-gate",
      detail: REJECTED_DETAIL,
    });
  });

  it("treats a demo-guard 403 as an ordinary failure (not an approval gate)", () => {
    const err = { response: { status: 403, data: { detail: DEMO_DETAIL } } };
    expect(passkeyRegisterErrorAction(err)).toEqual({ kind: "other" });
  });

  it("treats a 403 with no detail as an ordinary failure", () => {
    const action = passkeyRegisterErrorAction({ response: { status: 403 } });
    expect(action.kind).toBe("other");
  });

  it("treats non-403 errors as ordinary failures", () => {
    expect(passkeyRegisterErrorAction({ response: { status: 500 } })).toEqual({ kind: "other" });
    expect(passkeyRegisterErrorAction(new Error("boom"))).toEqual({ kind: "other" });
  });
});
