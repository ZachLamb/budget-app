"use client";

import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { useState, createContext, useContext, useEffect, useCallback } from "react";
import { authApi, type User } from "@/lib/api/auth";
import { formatErrorDetail } from "@/lib/api/client";
import { Toaster } from "@/components/ui/sonner";
import { toastErrorDiagnostic, toastPlainError } from "@/lib/toast-error";

/**
 * React Query retry predicate. Catches the cold-start window on the Fly
 * backend (scale-to-zero, ~5–10s wake-up). Server 5xx and network errors
 * are retried up to 3 times; client errors (4xx) are NOT retried — they
 * won't succeed by trying again, and 401 in particular has its own redirect
 * path via the axios interceptor.
 *
 * Exported for unit testing.
 */
export function queryRetry(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  // 4xx: malformed/forbidden/not-found — retrying won't help.
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  // 5xx or no response (network error, cold-start, timeout) — retry up to 3x.
  return failureCount < 3;
}

/**
 * Exponential backoff: 1s, 2s, 4s, capped at 8s. Combined with retry=3, this
 * gives the cold-start window ~7s of recovery time before the user sees a toast.
 *
 * Exported for unit testing.
 */
export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}

/** Extract HTTP status and API detail from an axios-shaped error. */
function authErrorFromUnknown(err: unknown): { status?: number; detail?: string } {
  const axiosErr = err as { response?: { status?: number; data?: { detail?: unknown } } };
  const status = axiosErr.response?.status;
  const raw = axiosErr.response?.data?.detail;
  const detail = raw !== undefined ? formatErrorDetail(raw) : undefined;
  return { status, detail };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User) => void;
  logout: () => void;
  /** Re-fetch /api/auth/me after the server sets a session cookie. */
  refreshSession: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  refreshSession: async () => {},
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // The httpOnly session cookie is the auth credential — JS can't read it
  // and shouldn't try to. ``token`` exists in the context only for legacy
  // callers that haven't been migrated yet; it's null after any post-cookie
  // login. New code must not depend on it.
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const clearLegacyAuthStorage = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const u = await authApi.me();
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setToken(null);
      setUser(u);
    } catch (err) {
      const { status, detail } = authErrorFromUnknown(err);
      clearLegacyAuthStorage();
      if (status === 403 && detail) {
        toastPlainError(detail);
      }
      throw err;
    }
  }, [clearLegacyAuthStorage]);

  useEffect(() => {
    let mounted = true;
    // Wake the Fly backend if it's cold-started (scale-to-zero). Fire-and-forget —
    // we don't await the result; the request itself is what triggers the wake-up.
    // By the time /auth/me and downstream queries run, the machine is at minimum
    // already waking, and React Query's retry config (see queryRetry/queryRetryDelay)
    // covers the residual race window.
    //
    // credentials: "omit" because /api/health is open and we want the lightest
    // possible request — no Cookie header processing on the server.
    void fetch("/api/health", { credentials: "omit", cache: "no-store" })
      .catch(() => undefined);

    queueMicrotask(() => {
      // Source of truth for "am I logged in" is /api/auth/me. The cookie
      // is sent automatically (withCredentials: true on the axios client).
      authApi
        .me()
        .then((u) => {
          if (mounted) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            setToken(null);
            setUser(u);
          }
        })
        .catch((err) => {
          if (!mounted) return;
          const { status, detail } = authErrorFromUnknown(err);
          clearLegacyAuthStorage();
          if (status === 403 && detail) {
            toastPlainError(detail);
          }
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    });
    return () => {
      mounted = false;
    };
  }, [clearLegacyAuthStorage]);

  // Kept for source-compatibility with existing callers (LoginPage, register
  // flow, passkey verify, Google callback). The server already set the
  // httpOnly cookie before we got here; we just hydrate React state.
  // We intentionally do NOT write the token to localStorage anymore — the
  // cookie is the durable session.
  const login = useCallback((newUser: User) => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    // Server-side cookie clear is the authoritative step. Fire-and-forget;
    // we still wipe local state immediately so the UI flips to logged-out.
    void authApi.logout().catch(() => {
      // Network failure shouldn't trap the user in a logged-in state.
    });
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, refreshSession, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

interface ThemeContextType {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    queueMicrotask(() => {
      const saved = localStorage.getItem("theme") as "light" | "dark" | null;
      const preferred = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setTheme(preferred);
      document.documentElement.classList.toggle("dark", preferred === "dark");
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "An unexpected error occurred";
  if (error instanceof Error) {
    // Axios errors carry response data
    const axiosErr = error as Error & { response?: { status?: number; data?: { detail?: unknown } } };
    if (axiosErr.response) {
      const status = axiosErr.response.status;
      const detail = axiosErr.response.data?.detail;
      if (detail) {
        return `[${status}] ${formatErrorDetail(detail)}`;
      }
      return `HTTP ${status}: ${error.message}`;
    }
    return error.message;
  }
  return String(error);
}

/**
 * Mutation-cache onError handler. Extracted for direct unit testing.
 * Skips 401s (auth interceptor handles those) and defers to per-mutation
 * `onError` if the caller defined one (avoids double-toasting).
 */
export function handleMutationError(
  error: unknown,
  mutation: { options: { onError?: unknown } },
): void {
  const axiosErr = error as Error & { response?: { status?: number } };
  if (axiosErr?.response?.status === 401) return;
  if (mutation.options.onError) return;
  toastErrorDiagnostic(
    "Action failed",
    extractErrorMessage(error),
    error as Error,
    { duration: 8000 },
  );
}

/** Skip global query error toast when the page shows inline ErrorState. */
export function shouldToastQueryError(query: { meta?: { inlineError?: boolean } }): boolean {
  return query.meta?.inlineError !== true;
}

/**
 * Query-cache onError handler. Extracted for unit testing.
 * Skips 401s and queries with meta.inlineError.
 */
export function handleQueryCacheError(
  error: unknown,
  query: { meta?: { inlineError?: boolean }; queryKey: readonly unknown[] },
  toast: (title: string, message: string, err: unknown) => void,
): void {
  const axiosErr = error as Error & { response?: { status?: number } };
  if (axiosErr?.response?.status === 401) return;
  if (!shouldToastQueryError(query)) return;
  const label = formatQueryResourceLabel(query.queryKey);
  toast(`Failed to load ${label}`, extractErrorMessage(error), error);
}

/** Human-readable fragment for query error toasts (e.g. paySchedule → "pay schedule"). */
function formatQueryResourceLabel(queryKey: readonly unknown[]): string {
  const raw = queryKey[0];
  if (typeof raw !== "string") return "data";
  const spaced = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .trim();
  if (!spaced) return "data";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            handleQueryCacheError(error, query, (title, message, err) => {
              toastErrorDiagnostic(title, message, err, { duration: 8000 });
            });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) =>
            handleMutationError(error, mutation),
        }),
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: queryRetry,
            retryDelay: queryRetryDelay,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
