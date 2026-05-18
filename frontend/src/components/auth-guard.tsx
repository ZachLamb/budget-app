"use client";

import { useAuth } from "@/lib/providers";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Navigation, MobileHeader } from "./navigation";
import { ErrorBoundary } from "./error-boundary";
import { AiAdvisor } from "./ai-advisor";
import { MobileSyncBanner } from "./mobile-sync-banner";
import { DemoBanner } from "./demo-banner";
import { PageTitleProvider } from "@/components/page";

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
      <div
        className="flex h-screen flex-col items-center justify-center gap-3"
        role="status"
        aria-busy="true"
        aria-label="Loading your budget"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading your budget…</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <PageTitleProvider>
      <div className="relative flex h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-background focus:border focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to main content
        </a>
        <Navigation />
        <main
          id="main-content"
          className="flex-1 overflow-auto bg-background"
          aria-label="Main content"
        >
          <DemoBanner />
          <MobileHeader />
          <MobileSyncBanner />
          <div className="mx-auto max-w-6xl p-4 md:p-6">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
        <AiAdvisor />
      </div>
    </PageTitleProvider>
  );
}
