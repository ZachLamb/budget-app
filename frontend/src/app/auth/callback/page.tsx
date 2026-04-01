"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/providers";
import { authApi } from "@/lib/api/auth";
import { toast } from "sonner";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    const finishWithToken = (token: string) => {
      localStorage.setItem("token", token);
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
          toast.error("Sign-in failed. Please try again.");
          router.replace("/login");
        });
    };

    const run = async () => {
      const code = searchParams.get("code");

      if (!code) {
        if (cancelled) return;
        setStatus("error");
        toast.error("No sign-in code received. Please try again.");
        router.replace("/login");
        return;
      }

      try {
        const res = await authApi.googleExchange(code);
        if (cancelled) return;
        finishWithToken(res.access_token);
      } catch {
        if (cancelled) return;
        setStatus("error");
        toast.error("Sign-in failed. Please try again.");
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
