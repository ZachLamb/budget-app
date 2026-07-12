import { toast as sonnerToast } from "sonner";
import { pushNotification } from "@/lib/notification-store";
import { TOAST_DURATION, toastDedupeId } from "@/lib/toast-config";

type AxiosLikeDetail =
  | string
  | Array<{ msg?: string; loc?: (string | number)[] }>;

type AxiosLikeError = {
  response?: { data?: { detail?: AxiosLikeDetail } };
};

function axiosDetail(error: unknown): AxiosLikeDetail | undefined {
  if (error === null || typeof error !== "object" || !("response" in error)) return undefined;
  const r = (error as AxiosLikeError).response?.data?.detail;
  return r;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = axiosDetail(error);
  if (detail === undefined) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    const msg = first?.msg ?? first?.loc?.join(" ") ?? JSON.stringify(first);
    return String(msg);
  }
  return fallback;
}

type AxiosLike = {
  response?: { status?: number; statusText?: string; data?: unknown };
  config?: { method?: string; baseURL?: string; url?: string };
};

/** Clipboard text: title, detail, request method/path, and HTTP status.

Raw response bodies and stack traces are included only in development —
production payloads can contain server internals (validation structures,
upstream error text) that don't belong on a user's clipboard. */
function buildErrorDiagnostics(title: string, detail: string, error: unknown): string {
  const includeSensitive = process.env.NODE_ENV !== "production";
  const lines = [title, "", detail];
  if (error && typeof error === "object") {
    const ax = error as AxiosLike & { message?: string; stack?: string };
    const cfg = ax.config;
    if (cfg?.url) {
      const method = (cfg.method || "GET").toUpperCase();
      const path = cfg.url.replace(/^https?:\/\/[^/]+/, "");
      const base = cfg.baseURL ?? "";
      lines.push("", `Request: ${method} ${base}${path.startsWith("/") ? path : `/${path}`}`);
    }
    if (ax.response) {
      const st = ax.response.status;
      const stText = ax.response.statusText || "";
      lines.push("", `HTTP: ${st}${stText ? ` ${stText}` : ""}`);
      const data = ax.response.data;
      if (includeSensitive && data !== undefined && data !== null) {
        lines.push(
          "",
          "Response body:",
          typeof data === "string" ? data : JSON.stringify(data, null, 2),
        );
      }
    }
    if (includeSensitive && typeof ax.stack === "string" && ax.stack.length > 0) {
      lines.push("", "Stack:", ax.stack);
    }
  }
  return lines.join("\n");
}

function copyAction(clipboardText: string) {
  return {
    label: "Copy",
    onClick: () => {
      void navigator.clipboard.writeText(clipboardText).then(
        () => {
          sonnerToast.success("Copied error details", {
            id: toastDedupeId("success", "Copied error details"),
            duration: TOAST_DURATION.copy,
          });
        },
        () => {
          sonnerToast.error("Could not copy to clipboard", {
            id: toastDedupeId("error", "Could not copy to clipboard"),
            duration: TOAST_DURATION.copy + 500,
          });
        },
      );
    },
  };
}

/** Error toast with title, detail line, and Copy (full diagnostics). */
export function toastErrorDiagnostic(
  title: string,
  detail: string,
  error: unknown,
  options?: { duration?: number },
): void {
  const clipboard = buildErrorDiagnostics(title, detail, error);
  pushNotification({
    kind: "error",
    title,
    description: detail,
    detailClipboard: clipboard,
  });
  sonnerToast.error(title, {
    id: toastDedupeId("error", `${title}:${detail}`),
    description: detail,
    duration: options?.duration ?? TOAST_DURATION.error,
    action: copyAction(clipboard),
  });
}

/** Prefer for API failures: uses getApiErrorMessage for the description line. */
export function toastApiError(context: string, error: unknown, options?: { duration?: number }): void {
  const detail = getApiErrorMessage(error, context);
  toastErrorDiagnostic(context, detail, error, options);
}

/** Validation or client-only messages (no Axios error object). */
export function toastPlainError(message: string, options?: { duration?: number }): void {
  pushNotification({
    kind: "error",
    title: message,
    description: undefined,
    detailClipboard: message,
  });
  sonnerToast.error(message, {
    id: toastDedupeId("error", message),
    duration: options?.duration ?? TOAST_DURATION.error - 2000,
    action: copyAction(message),
  });
}
