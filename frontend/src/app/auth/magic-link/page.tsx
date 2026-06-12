"use client";

/**
 * Magic-link verify landing page.
 *
 * Email links point at /auth/magic-link#token=<token> — the token rides in
 * the URL fragment, which browsers never send to servers (no access logs,
 * no Referer leakage). We read it client-side, POST it to the verify
 * endpoint, refresh session state from the new httpOnly cookie, then send
 * the user home. Legacy ?token= links from older emails still work.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api/auth";
import { useAuth } from "@/lib/providers";

/** Token from `#token=…` (current emails) or `?token=…` (legacy emails). */
function readTokenFromLocation(queryToken: string | null): string {
  if (typeof window !== "undefined" && window.location.hash.length > 1) {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hashParams.get("token");
    if (fromHash) return fromHash;
  }
  return queryToken || "";
}

function MagicLinkVerify() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const params = useSearchParams();
  const token = readTokenFromLocation(params.get("token"));

  const ranRef = useRef(false);
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // Scrub the token from the visible URL/history as soon as we've read it.
    if (typeof window !== "undefined" && (window.location.hash || params.get("token"))) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (!token) {
      queueMicrotask(() => setState("fail"));
      return;
    }
    let cancelled = false;
    let bounceTimer: ReturnType<typeof setTimeout> | null = null;
    queueMicrotask(() => {
      authApi
        .magicLinkVerify(token)
        .then(() => refreshSession())
        .then(() => {
          if (cancelled) return;
          setState("ok");
          bounceTimer = setTimeout(() => {
            if (!cancelled) router.replace("/");
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
  }, [token, router, refreshSession, params]);

  return <MagicLinkCard state={state} />;
}

function MagicLinkCard({ state }: { state: "loading" | "ok" | "fail" }) {
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
                That sign-in link isn&apos;t valid. It may have expired (15-minute window), been
                used already, or been copy-pasted incorrectly.
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
