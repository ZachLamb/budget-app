import axios from "axios";

function getServerBaseURL(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api`;
}

const api = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
  // Send the httpOnly session cookie on every request. Same-origin only —
  // cross-origin requires CORS allow-credentials, already configured server-side.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Evaluate at request time so client requests always use relative /api (never backend:8000).
  if (typeof window !== "undefined") {
    config.baseURL = "";
    const p = (config.url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+/g, "/") || "/";
    config.url = p.startsWith("/api") ? p : `/api${p.startsWith("/") ? p : `/${p}`}`;
    // Transition fallback: existing browser sessions still hold a JWT in
    // localStorage from before the cookie migration. Send it via Authorization
    // header so they keep working until they next log in (which will set the
    // cookie and clear the localStorage value via providers.tsx). Once a
    // user has logged in post-migration, no token is in localStorage and
    // this branch is a no-op.
    const legacyToken = localStorage.getItem("token");
    if (legacyToken) config.headers.Authorization = `Bearer ${legacyToken}`;
  } else {
    config.baseURL = getServerBaseURL();
  }
  return config;
});

/**
 * Response error handler. Exported so tests can invoke it directly
 * without reaching into axios's interceptor-handler internals — newer
 * axios registers its own handlers that can rewrite `err.code` during
 * normalization, which makes the "pick the last registered rejected
 * handler" trick unreliable across versions.
 */
/**
 * Routes that are valid entry points for an unauthenticated user. The 401
 * interceptor must NOT navigate to /login when we're already on one of
 * these — otherwise the AuthProvider's mount-time /auth/me call (which
 * 401s for any user without a session) bounces /login → /login → /login
 * forever. The user sees a constant page-refresh loop.
 */
const UNAUTHENTICATED_ROUTES = new Set(["/login", "/register"]);
function isOnUnauthenticatedRoute(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return UNAUTHENTICATED_ROUTES.has(path) || path.startsWith("/auth/");
}

export function handleResponseError(err: {
  response?: { status?: number; data?: { detail?: unknown } };
  code?: string;
  message?: string;
}): Promise<never> {
  if (err.response?.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    // Only navigate away if we're on an authenticated page. Inside the
    // auth flow itself (/login, /register, /auth/*), a 401 just means
    // "no session yet" and is expected; the per-page UI will handle it.
    if (!isOnUnauthenticatedRoute()) {
      window.location.href = "/login";
    }
  }
  // Surface the server's detail message so toast/error handlers show something useful
  if (err.code === "ECONNABORTED") {
    err.message = "Request timed out. Please try again.";
  } else if (err.code === "ERR_CANCELED") {
    err.message = "Request canceled.";
  } else if (err.response?.data?.detail) {
    const detail = err.response.data.detail;
    err.message = typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return Promise.reject(err);
}

api.interceptors.response.use((r) => r, handleResponseError);

export default api;
