"use client";

import { useEffect, useRef, useState } from "react";

const RECONNECT_DELAY_MS = 3000;
const SSE_URL = "/api/realtime/events";

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

    function connect() {
      es = new EventSource(SSE_URL, { withCredentials: true });

      es.onopen = () => {
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
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();

    return () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []); // intentionally empty — stable via ref

  return { connected };
}
