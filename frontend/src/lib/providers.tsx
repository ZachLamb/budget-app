"use client";

import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { useState, createContext, useContext, useEffect, useCallback } from "react";
import { authApi, type User } from "@/lib/api/auth";
import { Toaster } from "@/components/ui/sonner";
import { toastErrorDiagnostic } from "@/lib/toast-error";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      const savedToken = localStorage.getItem("token");
      if (savedToken) {
        setToken(savedToken);
        authApi
          .me()
          .then((u) => setUser(u))
          .catch(() => {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            setToken(null);
            setUser(null);
          })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, []);

  const login = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
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
        const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
        return `[${status}] ${msg}`;
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
            // Skip 401s — the auth interceptor already handles logout/redirect
            const axiosErr = error as Error & { response?: { status?: number } };
            if (axiosErr?.response?.status === 401) return;
            const label = formatQueryResourceLabel(query.queryKey);
            const title = `Failed to load ${label}`;
            toastErrorDiagnostic(title, extractErrorMessage(error), error, { duration: 8000 });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) =>
            handleMutationError(error, mutation),
        }),
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
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
