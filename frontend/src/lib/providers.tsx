"use client";

import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { useState, createContext, useContext, useEffect, useCallback } from "react";
import { authApi, type User } from "@/lib/api/auth";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

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

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            // Skip 401s — the auth interceptor already handles logout/redirect
            const axiosErr = error as Error & { response?: { status?: number } };
            if (axiosErr?.response?.status === 401) return;
            const label = (query.queryKey[0] as string) ?? "data";
            toast.error(`Failed to load ${label}`, {
              description: extractErrorMessage(error),
              duration: 6000,
            });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            const axiosErr = error as Error & { response?: { status?: number } };
            if (axiosErr?.response?.status === 401) return;
            toast.error("Action failed", {
              description: extractErrorMessage(error),
              duration: 6000,
            });
          },
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
