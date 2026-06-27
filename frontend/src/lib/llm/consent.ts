/**
 * Local consent (Tier 2 download, Lite-vs-3B). Stored in localStorage.
 */

import type { LocalConsent } from "./types";

const KEY = "clarity.llm.localConsent";

function read(): LocalConsent {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as LocalConsent;
  } catch {
    return {};
  }
}

function write(consent: LocalConsent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(consent));
  } catch {
    // Storage is best-effort. If localStorage is wedged, we don't break the app.
  }
}

export function getLocalConsent(): LocalConsent {
  return read();
}

export function setDownloadModel(decision: "granted" | "denied"): void {
  write({ ...read(), downloadModel: decision });
}

export function setUseLiteModel(useLite: boolean): void {
  write({ ...read(), useLiteModel: useLite });
}

export function clearLocalConsent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
