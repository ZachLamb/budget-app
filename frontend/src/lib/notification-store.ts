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

let notifications: AppNotification[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
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
  const id = input.id ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `n-${Date.now()}`);
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
