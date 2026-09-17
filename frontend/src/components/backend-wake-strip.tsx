"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  useBackendWake,
  type UseBackendWakeOptions,
  WAKE_ESTIMATE_MS,
  WAKE_REVEAL_AFTER_MS,
} from "@/lib/use-backend-wake";

const READY_VISIBLE_MS = 2_000;

/**
 * Cold-start status strip for the login page.
 *
 * Renders nothing when the backend is warm — the common case must not be
 * penalised with a flash of "loading" UI. It appears only once the wake-up has
 * already taken longer than a user would accept in silence, and it never
 * disables the sign-in form: you can type your credentials while the container
 * boots.
 *
 * See useBackendWake for why the progress figure is an estimate.
 */
export function BackendWakeStrip(options: UseBackendWakeOptions = {}) {
  const wake = useBackendWake(options);
  const [hideReady, setHideReady] = useState(false);

  // Derived, not stored: elapsedMs freezes when the probe settles, so a wake
  // that crossed the reveal threshold is still identifiable after the fact.
  // Deriving avoids a setState-in-effect cascade.
  const everRevealed =
    wake.elapsedMs >= (options.revealAfterMs ?? WAKE_REVEAL_AFTER_MS);

  useEffect(() => {
    if (wake.status !== "ready" || !everRevealed) return;
    const t = setTimeout(() => setHideReady(true), READY_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [wake.status, everRevealed]);

  // Warm backend, or the confirmation has run its course.
  if (wake.status === "idle") return null;
  if (wake.status === "ready" && (!everRevealed || hideReady)) return null;

  const seconds = Math.floor(wake.elapsedMs / 1000);
  const estimateSeconds = Math.round(
    (options.estimateMs ?? WAKE_ESTIMATE_MS) / 1000,
  );

  if (wake.status === "error") {
    return (
      <div
        className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <AlertCircle
            className="h-4 w-4 shrink-0 text-destructive"
            aria-hidden
          />
          <p className="flex-1 text-foreground">
            <span className="font-medium">Can&apos;t reach the server.</span>{" "}
            Check your connection — signing in will retry automatically.
          </p>
        </div>
      </div>
    );
  }

  if (wake.status === "ready") {
    return (
      <div
        className="mb-4 rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400"
            aria-hidden
          />
          <p className="flex-1 text-foreground">
            Server ready{seconds > 0 ? ` — took ${seconds}s` : ""}.
          </p>
        </div>
      </div>
    );
  }

  const percent = Math.round(wake.progress * 100);

  // The live region deliberately wraps ONLY the fixed explanation. The seconds
  // counter re-renders every tick and the progress bar every 250ms; with either
  // inside `role="status"`, a screen reader re-announces the whole strip about
  // once a second for the entire cold start. The counter is decorative (the bar
  // carries the same information via aria-valuetext, read on demand), so it is
  // hidden, and the bar sits outside the region.
  return (
    <div className="mb-4 rounded-lg border border-blue-200/80 bg-blue-50/90 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
      <div className="flex items-center gap-2">
        <Loader2
          className="h-4 w-4 shrink-0 text-blue-700 motion-safe:animate-spin dark:text-blue-300"
          aria-hidden
        />
        <p className="flex-1 text-foreground" role="status" aria-live="polite">
          <span className="font-medium">Waking the server…</span>{" "}
          <span className="text-muted-foreground">
            It sleeps when idle and takes about {estimateSeconds}s to start. You
            can enter your details now.
          </span>
        </p>
        <span
          className="shrink-0 tabular-nums text-muted-foreground"
          aria-hidden
        >
          {seconds}s
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`Starting up, about ${wake.secondsRemaining ?? 0} seconds remaining`}
        aria-label="Server start-up progress"
      >
        <div
          className="h-full rounded-full bg-blue-600 motion-safe:transition-[width] motion-safe:duration-300 dark:bg-blue-400"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
