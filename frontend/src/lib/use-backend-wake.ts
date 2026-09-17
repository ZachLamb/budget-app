"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks the backend's cold-start wake-up so the login page can show progress.
 *
 * Render's free plan spins the service down after ~15 minutes idle; the next
 * request pays a full container boot (measured p50 ~35s on 2026-09-13). The
 * wake-up ping itself already existed in providers.tsx as fire-and-forget —
 * this hook is the same request with its timing surfaced.
 *
 * The progress value is an ESTIMATE and nothing else. A server that is asleep
 * cannot report how far along its own boot is, so there is no honest source of
 * real progress. We interpolate against the measured p50 and deliberately cap
 * at 90% until a response actually lands — a bar that sits at 100% while the
 * user still waits is worse than no bar at all.
 */

export const WAKE_REVEAL_AFTER_MS = 1_500;
export const WAKE_ESTIMATE_MS = 35_000;
const WAKE_TICK_MS = 250;
const WAKE_PROGRESS_CAP = 0.9;

export type BackendWakeState = {
  /**
   * "idle"   — request in flight but still under the reveal threshold; render nothing.
   * "waking" — taking long enough that the user deserves an explanation.
   * "ready"  — backend answered.
   * "error"  — backend could not be reached at all (offline, DNS, 5xx).
   */
  status: "idle" | "waking" | "ready" | "error";
  elapsedMs: number;
  /** 0..1. Capped below 1 until the backend actually responds. */
  progress: number;
  /** Whole seconds remaining against the estimate; null once resolved. */
  secondsRemaining: number | null;
};

export type UseBackendWakeOptions = {
  /** Skip the probe entirely (used by tests and by the demo build). */
  enabled?: boolean;
  revealAfterMs?: number;
  estimateMs?: number;
  /** Injectable for tests. */
  probe?: () => Promise<unknown>;
};

function defaultProbe(): Promise<unknown> {
  // credentials omitted so the server does no cookie work — this is the
  // lightest request that still forces the container to boot.
  return fetch("/api/health", { credentials: "omit", cache: "no-store" }).then(
    (res) => {
      if (!res.ok) throw new Error(`health ${res.status}`);
      return res;
    },
  );
}

export function useBackendWake(
  options: UseBackendWakeOptions = {},
): BackendWakeState {
  const {
    enabled = true,
    revealAfterMs = WAKE_REVEAL_AFTER_MS,
    estimateMs = WAKE_ESTIMATE_MS,
    probe = defaultProbe,
  } = options;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [resolved, setResolved] = useState<"ready" | "error" | null>(null);
  // Ref so the ticker never restarts when the probe settles.
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    startedAtRef.current = Date.now();

    const tick = setInterval(() => {
      if (!mounted || startedAtRef.current === null) return;
      setElapsedMs(Date.now() - startedAtRef.current);
    }, WAKE_TICK_MS);

    void Promise.resolve()
      .then(probe)
      .then(() => {
        if (mounted) setResolved("ready");
      })
      .catch(() => {
        if (mounted) setResolved("error");
      })
      .finally(() => {
        if (!mounted || startedAtRef.current === null) return;
        // Freeze elapsed at the moment of resolution so the strip reports the
        // real wake duration rather than continuing to count.
        setElapsedMs(Date.now() - startedAtRef.current);
        clearInterval(tick);
      });

    return () => {
      mounted = false;
      clearInterval(tick);
    };
  }, [enabled, probe]);

  if (resolved === "ready") {
    return { status: "ready", elapsedMs, progress: 1, secondsRemaining: null };
  }
  if (resolved === "error") {
    return { status: "error", elapsedMs, progress: 1, secondsRemaining: null };
  }

  const progress = Math.min(WAKE_PROGRESS_CAP, elapsedMs / estimateMs);
  const status = elapsedMs >= revealAfterMs ? "waking" : "idle";
  const secondsRemaining = Math.max(
    0,
    Math.ceil((estimateMs - elapsedMs) / 1000),
  );

  return { status, elapsedMs, progress, secondsRemaining };
}
