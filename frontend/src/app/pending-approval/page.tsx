"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Clock, LogOut, ShieldX } from "lucide-react";
import { useAuth } from "@/lib/providers";
import { Button } from "@/components/ui/button";

/**
 * Holding page for signed-in users whose account hasn't been approved yet
 * (admin approval gate). Approved users are bounced back into the app;
 * signed-out users go to login.
 */
export default function PendingApprovalPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.status === "approved") {
      router.replace("/");
    }
  }, [loading, user, router]);

  if (loading || !user || user.status === "approved") {
    return (
      <div className="flex h-screen items-center justify-center" role="status" aria-busy="true">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const rejected = user.status === "rejected";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          {rejected ? (
            <ShieldX className="h-7 w-7 text-destructive" aria-hidden="true" />
          ) : (
            <Clock className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">
            {rejected ? "Access denied" : "Awaiting approval"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rejected
              ? "Your account request was declined. If you think this is a mistake, contact the administrator."
              : "Your account is waiting for an administrator to approve it. You'll be able to sign in normally once that happens — check back soon."}
          </p>
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
