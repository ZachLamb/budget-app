type AxiosLike = { response?: { status?: number; data?: { detail?: unknown } } };

/**
 * The passkey register-verify endpoint 403s AFTER creating the account when
 * the admin-approval gate rejects the user (pending/rejected status). That is
 * a successful signup awaiting approval, not a registration failure.
 *
 * Other middleware (DemoGuardMiddleware, origin-check) also returns 403 for
 * completely different reasons. We must only treat the admin-gate 403 as an
 * approval-gate result; all other 403s are ordinary failures.
 */
export function passkeyRegisterErrorAction(
  err: unknown,
): { kind: "approval-gate"; detail: string } | { kind: "other" } {
  const resp = (err as AxiosLike | null)?.response;
  if (resp?.status !== 403) return { kind: "other" };
  const detail = resp.data?.detail;
  if (typeof detail !== "string") return { kind: "other" };
  if (detail.includes("awaiting approval") || detail.includes("denied access")) {
    return { kind: "approval-gate", detail };
  }
  return { kind: "other" };
}
