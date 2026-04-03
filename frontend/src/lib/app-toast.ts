"use client";

import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import { pushNotification } from "@/lib/notification-store";

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
    pushNotification({
      kind: "success",
      title: titleFromMessage(message),
      description: descriptionFromData(data),
    });
    return sonnerToast.success(message, data);
  },

  info(message: ReactNode, data?: Parameters<typeof sonnerToast.info>[1]) {
    pushNotification({
      kind: "info",
      title: titleFromMessage(message),
      description: descriptionFromData(data),
    });
    return sonnerToast.info(message, data);
  },

  warning(message: ReactNode, data?: Parameters<typeof sonnerToast.warning>[1]) {
    pushNotification({
      kind: "warning",
      title: titleFromMessage(message),
      description: descriptionFromData(data),
    });
    return sonnerToast.warning(message, data);
  },
};
