/**
 * Native app login hand-off.
 *
 * The macOS app opens this login page inside an ASWebAuthenticationSession so
 * that passkeys work (native passkey APIs can't target localhost, but the
 * Safari-backed sheet can). After a successful browser login we mint a
 * one-time code and redirect to the app's custom scheme, which closes the
 * sheet and hands the code back to the app.
 */

/**
 * Redirect targets the login page will hand a code to.
 *
 * The backend enforces its own NATIVE_CLIENT_REDIRECT_URIS allowlist — this is
 * the client-side half of that check, so a tampered `redirect_uri` query param
 * can't turn this page into an open redirect that leaks a login code.
 */
const ALLOWED_NATIVE_REDIRECTS = ["budget://auth/callback"] as const;

export interface NativeHandoff {
  redirectUri: string;
}

/**
 * Parse native-mode params from the login URL.
 *
 * Returns null unless `native=1` is present with an allowlisted `redirect_uri`
 * — so ordinary web logins are entirely unaffected.
 */
export function parseNativeHandoff(
  params: Pick<URLSearchParams, "get">,
): NativeHandoff | null {
  if (params.get("native") !== "1") return null;
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri) return null;
  if (!ALLOWED_NATIVE_REDIRECTS.includes(redirectUri as (typeof ALLOWED_NATIVE_REDIRECTS)[number])) {
    return null;
  }
  return { redirectUri };
}

/** Build the deep link that returns the one-time code to the native app. */
export function buildNativeCallbackURL(redirectUri: string, code: string): string {
  const separator = redirectUri.includes("?") ? "&" : "?";
  return `${redirectUri}${separator}code=${encodeURIComponent(code)}`;
}
