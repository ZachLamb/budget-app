"use client";

/**
 * Magic-link verify landing page.
 *
 * Email links point at /auth/magic-link?token=<token>. We pull the token,
 * call the backend, and on success let the auth provider hydrate from
 * the new session cookie before bouncing to the app.
 *
 * Generic error copy on failure — never reveal whether the token never
 * existed vs was already used vs expired. From a probing attacker's view,
 * all three look the same.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api/auth";

function MagicLinkVerify() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  // StrictMode double-mounts effects in dev. The backend redeem is single-use,
  // so the second fire would 400 — guard with a ref to fire exactly once per
  // mounted page instance.
  const ranRef = useRef(false);
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (!token) {
      // Defer to next tick so we don't setState during render.
      queueMicrotask(() => setState("fail"));
      return;
    }
    let cancelled = false;
    let bounceTimer: ReturnType<typeof setTimeout> | null = null;
    queueMicrotask(() => {
      authApi
        .magicLinkVerify(token)
        .then(() => {
          if (cancelled) return;
          setState("ok");
          // Small delay so the user sees the success state, then bounce.
          bounceTimer = setTimeout(() => {
            if (!cancelled) router.push("/");
          }, 600);
        })
        .catch(() => {
          if (!cancelled) setState("fail");
        });
    });
    return () => {
      cancelled = true;
      if (bounceTimer !== null) clearTimeout(bounceTimer);
    };
  }, [token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === "loading" && (
              <>
                <Loader2 className="size-5 animate-spin" /> Signing you in…
              </>
            )}
            {state === "ok" && (
              <>
                <CheckCircle2 className="size-5 text-green-600" /> Signed in
              </>
            )}
            {state === "fail" && (
              <>
                <AlertTriangle className="size-5 text-amber-600" /> Couldn&apos;t sign in
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {state === "loading" && (
            <p className="text-muted-foreground">Validating your sign-in link…</p>
          )}
          {state === "ok" && (
            <p className="text-muted-foreground">Taking you to the app…</p>
          )}
          {state === "fail" && (
            <>
              <p className="text-muted-foreground">
                That sign-in link isn&apos;t valid. It may have expired (15-minute
                window), been used already, or been copy-pasted incorrectly.
              </p>
              <p className="text-muted-foreground">
                Request a fresh one — they&apos;re free and only take a second.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function MagicLinkVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <MagicLinkVerify />
    </Suspense>
  );
}
