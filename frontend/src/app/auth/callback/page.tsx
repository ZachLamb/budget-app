"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/providers";
import { authApi } from "@/lib/api/auth";
import { toast } from "sonner";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      toast.error("No token received. Please sign in again.");
      router.replace("/login");
      return;
    }

    localStorage.setItem("token", token);
    authApi
      .me()
      .then((user) => {
        login(token, user);
        setStatus("done");
        router.replace("/");
      })
      .catch(() => {
        localStorage.removeItem("token");
        setStatus("error");
        toast.error("Sign-in failed. Please try again.");
        router.replace("/login");
      });
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
