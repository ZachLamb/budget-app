"use client";

import { useAuth } from "@/lib/providers";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Navigation, MobileHeader } from "./navigation";
import { ErrorBoundary } from "./error-boundary";
import { AiAdvisor } from "./ai-advisor";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen">
      <Navigation />
      <main className="flex-1 overflow-auto bg-background">
        <MobileHeader />
        <div className="mx-auto max-w-6xl p-4 md:p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
      <AiAdvisor />
    </div>
  );
}
