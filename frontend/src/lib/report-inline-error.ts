import { pushNotification } from "@/lib/notification-store";

/**
 * Record an error shown inline on the page (no Sonner toast — avoids overlapping
 * with contextual banners like MaybeAiErrorWithSettings).
 */
export function reportInlineError(
  title: string,
  options?: { description?: string; detailClipboard?: string },
): void {
  pushNotification({
    kind: "error",
    title,
    description: options?.description,
    detailClipboard: options?.detailClipboard ?? title,
  });
}
