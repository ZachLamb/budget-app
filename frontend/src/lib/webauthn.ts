/**
 * WebAuthn / passkey helpers: base64url decode, options parsing, and feature detection.
 */

/** Decode a base64url string to ArrayBuffer (handles padding). */
export function decodeBase64url(s: string): ArrayBuffer {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "==".slice(0, 4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Parse registration options (string or object) and decode challenge/user.id to ArrayBuffer. */
export function parseCreationOptions(
  options: string | CredentialCreationOptions
): CredentialCreationOptions {
  const obj =
    typeof options === "string"
      ? (JSON.parse(options) as CredentialCreationOptions)
      : { ...options };
  const pk = obj.publicKey ?? (obj as Record<string, unknown>);
  if (typeof pk.challenge === "string") {
    pk.challenge = decodeBase64url(pk.challenge);
  }
  const user = pk.user ?? (obj as { user?: { id: unknown } }).user;
  if (user?.id && typeof (user as { id: unknown }).id === "string") {
    (user as { id: ArrayBuffer }).id = decodeBase64url((user as { id: string }).id);
  }
  return obj;
}

/** Parse authentication options (string or object) and decode challenge and allowCredentials[].id. */
export function parseRequestOptions(
  options: string | CredentialRequestOptions
): CredentialRequestOptions {
  const obj =
    typeof options === "string"
      ? (JSON.parse(options) as CredentialRequestOptions)
      : { ...options };
  const pk = obj.publicKey ?? (obj as Record<string, unknown>);
  if (typeof pk.challenge === "string") {
    pk.challenge = decodeBase64url(pk.challenge);
  }
  const allowCredentials = pk.allowCredentials ?? (obj as { allowCredentials?: unknown[] }).allowCredentials;
  if (allowCredentials?.length) {
    const decoded = allowCredentials.map((c: { id: string } & PublicKeyCredentialDescriptor) => ({
      ...c,
      id: typeof c.id === "string" ? decodeBase64url(c.id) : c.id,
    }));
    pk.allowCredentials = decoded;
  }
  return obj;
}

/** True if the environment supports WebAuthn (PublicKeyCredential). */
export function supportsPasskey(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function"
  );
}
