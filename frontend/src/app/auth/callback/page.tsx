"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/providers";
import { authApi, type TokenResponse } from "@/lib/api/auth";
import { toastPlainError } from "@/lib/toast-error";

/**
 * Single-flight dedup: React StrictMode double-mounts effects in dev, which
 * would fire two parallel exchanges. The backend pops the login code on the
 * first call — the second would 400. One module-level promise covers the
 * whole page lifetime; cleared after 60s (matches the server-side TTL).
 */
let googleExchangeInFlight: Promise<TokenResponse> | null = null;

function exchangeGoogleCodeOnce(): Promise<TokenResponse> {
  if (!googleExchangeInFlight) {
    const p = authApi.googleExchange();
    googleExchangeInFlight = p;
    void p.finally(() => {
      setTimeout(() => {
        if (googleExchangeInFlight === p) googleExchangeInFlight = null;
      }, 60_000);
    });
  }
  return googleExchangeInFlight;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    const finishWithToken = (token: string) => {
      authApi
        .me()
        .then((user) => {
          if (cancelled) return;
          login(token, user);
          setStatus("done");
          router.replace("/");
        })
        .catch(() => {
          if (cancelled) return;
          localStorage.removeItem("token");
          setStatus("error");
          toastPlainError("Sign-in failed. Please try again.");
          router.replace("/login");
        });
    };

    exchangeGoogleCodeOnce()
      .then((res) => {
        if (cancelled) return;
        finishWithToken(res.access_token);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        toastPlainError("Sign-in failed. Please try again.");
        router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [login, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        {status === "loading" && (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-sm text-muted-foreground">Completing sign-in...</p>
          </>
        )}
        {status === "error" && (
          <p className="text-sm text-muted-foreground">Redirecting to login...</p>
        )}
      </div>
    </div>
  );
}
