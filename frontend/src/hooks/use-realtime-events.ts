"use client";

import { useEffect, useRef, useState } from "react";

const SSE_URL = "/api/realtime/events";

/**
 * Reconnect backoff.
 *
 * A fixed short delay is worse than useless here: the SSE route is rate-limited
 * to 10 connections/minute per IP, so retrying every 3s (20/min) guarantees a
 * 429, which itself triggers `onerror` — the client locks itself out for as
 * long as the tab stays open. Exponential backoff keeps the steady-state
 * attempt rate under the server's cap, and jitter stops every tab in the
 * household from retrying in lockstep after a backend restart.
 */
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const JITTER_RATIO = 0.25;

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    MAX_RECONNECT_DELAY_MS,
  );
  // Full-jitter band around the target: ±25%.
  const jitter = exponential * JITTER_RATIO * (random() * 2 - 1);
  return Math.max(BASE_RECONNECT_DELAY_MS, Math.round(exponential + jitter));
}

export function useRealtimeEvents(
  onEvent: (type: string) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Keep a stable ref to onEvent so we don't re-subscribe on every render
  // when the caller passes an inline arrow function.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    function connect() {
      es = new EventSource(SSE_URL, { withCredentials: true });

      es.onopen = () => {
        // A connection that actually opened resets the backoff, so a single
        // blip doesn't leave the tab on a minute-long delay afterwards.
        attempt = 0;
        setConnected(true);
      };

      es.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data as string);
          // Treat LLM/external output as untrusted — only extract the string
          // type field; don't forward arbitrary structure.
          if (payload && typeof payload.type === "string") {
            onEventRef.current(payload.type);
          }
        } catch {
          // Malformed JSON — ignore silently per spec
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (closed) return;
        attempt += 1;
        reconnectTimer = setTimeout(connect, reconnectDelayMs(attempt));
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []); // intentionally empty — stable via ref

  return { connected };
}
