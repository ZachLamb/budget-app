"use client";

import { useSyncExternalStore } from "react";

export type NotificationKind = "error" | "success" | "info" | "warning";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  description?: string;
  /** Full diagnostics for errors (matches toast Copy). */
  detailClipboard?: string;
  createdAt: number;
  read: boolean;
};

const MAX_ITEMS = 80;
const DEDUPE_WINDOW_MS = 4000;

let notifications: AppNotification[] = [];
const listeners = new Set<() => void>();
let idCounter = 0;

/**
 * Unique id, `crypto.randomUUID` when available.
 *
 * The fallback has to include a counter: a burst of notifications (a page that
 * fires several failing requests at once) lands inside the same millisecond, and
 * a bare timestamp would hand React duplicate keys for distinct rows.
 */
function nextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `n-${Date.now()}-${idCounter}`;
}

function emit() {
  listeners.forEach((l) => l());
}

function findRecentDuplicate(
  input: Omit<AppNotification, "id" | "createdAt" | "read">,
): AppNotification | undefined {
  const now = Date.now();
  return notifications.find(
    (n) =>
      n.kind === input.kind &&
      n.title === input.title &&
      (n.description ?? "") === (input.description ?? "") &&
      now - n.createdAt < DEDUPE_WINDOW_MS,
  );
}

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getNotificationSnapshot(): AppNotification[] {
  return notifications;
}

export function pushNotification(
  input: Omit<AppNotification, "id" | "createdAt" | "read"> & { id?: string },
): string {
  const duplicate = findRecentDuplicate(input);
  if (duplicate) return duplicate.id;

  const id = input.id ?? nextId();
  const n: AppNotification = {
    id,
    kind: input.kind,
    title: input.title,
    description: input.description,
    detailClipboard: input.detailClipboard,
    createdAt: Date.now(),
    read: false,
  };
  notifications = [n, ...notifications].slice(0, MAX_ITEMS);
  emit();
  return id;
}

export function markNotificationRead(id: string) {
  notifications = notifications.map((x) => (x.id === id ? { ...x, read: true } : x));
  emit();
}

export function markAllNotificationsRead() {
  notifications = notifications.map((x) => ({ ...x, read: true }));
  emit();
}

export function clearAllNotifications() {
  notifications = [];
  emit();
}

export function useNotifications(): AppNotification[] {
  return useSyncExternalStore(
    subscribe,
    getNotificationSnapshot,
    () => [],
  );
}
