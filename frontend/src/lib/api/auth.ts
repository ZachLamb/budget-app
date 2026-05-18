import api from "./client";

export interface User {
  id: string;
  email: string;
  name: string;
  household_id: string;
  /** "owner" for normal users, "admin" for the bootstrapped admin (configured
   *  on the backend via ADMIN_EMAIL). Only "admin" can access /api/admin/*. */
  role: string;
  /** "pending" | "approved" | "rejected". The auth gate is enforced server-side;
   *  the frontend uses this only for rendering (e.g. hiding the admin panel,
   *  showing an "awaiting approval" page if a stale session sneaks through). */
  status: string;
  created_at: string;
}

export interface TokenResponse {
  access_token?: string | null;
  token_type?: string;
  user: User;
}

/** Encode ArrayBuffer as base64url (no padding). */
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Serialize PublicKeyCredential to JSON for the server (base64url-encoded binary fields). */
export function credentialToJSON(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  const r: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
  if ("attestationObject" in response) {
    (r.response as Record<string, unknown>).attestationObject = bufferToBase64url(response.attestationObject);
  }
  if ("authenticatorData" in response) {
    (r.response as Record<string, unknown>).authenticatorData = bufferToBase64url(response.authenticatorData);
    (r.response as Record<string, unknown>).signature = bufferToBase64url(response.signature);
    if (response.userHandle) (r.response as Record<string, unknown>).userHandle = bufferToBase64url(response.userHandle);
  }
  return r;
}

export const authApi = {
  register: (data: { email: string; name: string; password: string; household_name?: string }) =>
    api.post<TokenResponse>("/auth/register", data).then((r) => r.data),
  login: (data: { email: string; password: string }) =>
    api.post<TokenResponse>("/auth/login", data).then((r) => r.data),
  demoLogin: () =>
    api.post<TokenResponse>("/auth/demo-login").then((r) => r.data),
  /**
   * Exchange the HttpOnly `oauth_login_code` cookie set by /api/auth/google/callback
   * for a JWT. No request body — the cookie is sent automatically on this
   * same-origin POST (path-scoped to this endpoint).
   */
  googleExchange: () =>
    api.post<TokenResponse>("/auth/google/exchange").then((r) => r.data),
  me: () => api.get<User>("/auth/me").then((r) => r.data),
  // Passkey (WebAuthn)
  passkeyRegisterOptions: (data: { email: string; name: string; household_name?: string }) =>
    api.post<{ options: string }>("/auth/passkey/register/options", data).then((r) => r.data),
  passkeyRegisterVerify: (credential: Record<string, unknown>) =>
    api.post<TokenResponse>("/auth/passkey/register/verify", { credential }).then((r) => r.data),
  passkeyAuthenticateOptions: (data: { email?: string }) =>
    api.post<{ options: string }>("/auth/passkey/authenticate/options", data).then((r) => r.data),
  passkeyAuthenticateVerify: (credential: Record<string, unknown>) =>
    api.post<TokenResponse>("/auth/passkey/authenticate/verify", { credential }).then((r) => r.data),
  // Passkey management (authenticated)
  passkeyListCredentials: () =>
    api.get<PasskeyCredentialItem[]>("/auth/passkey/credentials").then((r) => r.data),
  passkeyDeleteCredential: (id: string) =>
    api.delete(`/auth/passkey/credentials/${id}`).then((r) => r.data),
  passkeyAddOptions: () =>
    api.post<{ options: string }>("/auth/passkey/add/options").then((r) => r.data),
  passkeyAddVerify: (credential: Record<string, unknown>) =>
    api.post<{ ok: boolean }>("/auth/passkey/add/verify", { credential }).then((r) => r.data),
  /**
   * Magic-link sign-in (passwordless). The request endpoint ALWAYS returns
   * 200 regardless of whether the email exists in the DB — that's the
   * anti-enumeration property we rely on. Callers should display a generic
   * "check your email" message based on `ok` alone; the absence of an
   * email in the inbox is the only signal the user receives if their email
   * isn't registered. Do not surface "unknown email" UX from this response.
   */
  magicLinkRequest: (email: string) =>
    api.post<{ ok: true }>("/auth/magic-link/request", { email }).then((r) => r.data),

  /** Redeem the token from the email URL. Server sets the httpOnly session cookie. */
  magicLinkVerify: (token: string) =>
    api.get<{ ok: true }>(`/auth/magic-link/verify?token=${encodeURIComponent(token)}`).then((r) => r.data),

  /**
   * Clear the httpOnly session cookie. Idempotent — safe to call on a
   * stale session. The frontend should call this in response to a user
   * logout action; the server-side cookie is the source of truth.
   */
  logout: () => api.post<{ ok: true }>("/auth/logout").then((r) => r.data),
};

export interface PasskeyCredentialItem {
  id: string;
  created_at: string;
}
