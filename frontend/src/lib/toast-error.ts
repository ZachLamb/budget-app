import { toast as sonnerToast } from "sonner";
import { getApiErrorMessage } from "@/lib/hooks";
import { pushNotification } from "@/lib/notification-store";

type AxiosLike = {
  response?: { status?: number; statusText?: string; data?: unknown };
  config?: { method?: string; baseURL?: string; url?: string };
};

/** Full text for clipboard: title, detail, request/response hints, optional stack. */
export function buildErrorDiagnostics(title: string, detail: string, error: unknown): string {
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
      if (data !== undefined && data !== null) {
        lines.push(
          "",
          "Response body:",
          typeof data === "string" ? data : JSON.stringify(data, null, 2),
        );
      }
    }
    if (typeof ax.stack === "string" && ax.stack.length > 0) {
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
          sonnerToast.success("Copied error details", { duration: 2000 });
        },
        () => {
          sonnerToast.error("Could not copy to clipboard", { duration: 2500 });
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
    description: detail,
    duration: options?.duration ?? 8000,
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
    duration: options?.duration ?? 6000,
    action: copyAction(message),
  });
}
