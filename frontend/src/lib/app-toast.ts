"use client";

import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import { pushNotification } from "@/lib/notification-store";
import { TOAST_DURATION, toastDedupeId } from "@/lib/toast-config";

function titleFromMessage(message: ReactNode): string {
  if (typeof message === "string" || typeof message === "number") return String(message);
  return "Notification";
}

function descriptionFromData(data?: Parameters<typeof sonnerToast.success>[1]): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = "description" in data ? data.description : undefined;
  if (typeof d === "string") return d;
  if (typeof d === "function") {
    const v = d();
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

/** Toast + in-app notification center (success / info / warning). */
export const appToast = {
  success(message: ReactNode, data?: Parameters<typeof sonnerToast.success>[1]) {
    const title = titleFromMessage(message);
    pushNotification({
      kind: "success",
      title,
      description: descriptionFromData(data),
    });
    return sonnerToast.success(message, {
      ...data,
      id: toastDedupeId("success", title),
      duration: data?.duration ?? TOAST_DURATION.success,
    });
  },

  info(message: ReactNode, data?: Parameters<typeof sonnerToast.info>[1]) {
    const title = titleFromMessage(message);
    pushNotification({
      kind: "info",
      title,
      description: descriptionFromData(data),
    });
    return sonnerToast.info(message, {
      ...data,
      id: toastDedupeId("info", title),
      duration: data?.duration ?? TOAST_DURATION.info,
    });
  },

  warning(message: ReactNode, data?: Parameters<typeof sonnerToast.warning>[1]) {
    const title = titleFromMessage(message);
    pushNotification({
      kind: "warning",
      title,
      description: descriptionFromData(data),
    });
    return sonnerToast.warning(message, {
      ...data,
      id: toastDedupeId("warning", title),
      duration: data?.duration ?? TOAST_DURATION.warning,
    });
  },
};
