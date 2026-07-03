type AxiosLike = { response?: { status?: number; data?: { detail?: unknown } } };

/**
 * The passkey register-verify endpoint 403s AFTER creating the account when
 * the admin-approval gate rejects the user (pending/rejected status). That is
 * a successful signup awaiting approval, not a registration failure.
 */
export function passkeyRegisterErrorAction(
  err: unknown,
): { kind: "approval-gate"; detail: string } | { kind: "other" } {
  const resp = (err as AxiosLike | null)?.response;
  if (resp?.status !== 403) return { kind: "other" };
  const detail = resp.data?.detail;
  return {
    kind: "approval-gate",
    detail: typeof detail === "string" ? detail : "Your account is awaiting approval.",
  };
}
