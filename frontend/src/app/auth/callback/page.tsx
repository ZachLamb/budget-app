"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/providers";
import { authApi, type TokenResponse } from "@/lib/api/auth";
import { toastPlainError } from "@/lib/toast-error";

/** One exchange per code: avoids burning the server one-time code under React Strict Mode double effects. */
const googleExchangeByCode = new Map<string, Promise<TokenResponse>>();

function exchangeGoogleCodeOnce(code: string): Promise<TokenResponse> {
  let p = googleExchangeByCode.get(code);
  if (!p) {
    p = authApi.googleExchange(code);
    googleExchangeByCode.set(code, p);
    void p.finally(() => {
      setTimeout(() => googleExchangeByCode.delete(code), 60_000);
    });
  }
  return p;
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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

    const run = async () => {
      const code = searchParams.get("code");

      if (!code) {
        if (cancelled) return;
        setStatus("error");
        toastPlainError("No sign-in code received. Please try again.");
        router.replace("/login");
        return;
      }

      try {
        const res = await exchangeGoogleCodeOnce(code);
        if (cancelled) return;
        finishWithToken(res.access_token);
      } catch {
        if (cancelled) return;
        setStatus("error");
        toastPlainError("Sign-in failed. Please try again.");
        router.replace("/login");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [searchParams, login, router]);

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

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
