/**
 * Self-service account endpoints (export and delete).
 *
 * These hit auth-gated, per-user rate-limited endpoints on the backend.
 * They use raw `fetch` instead of the shared axios client because the
 * export response is a streaming JSON file that we need to forward to
 * the browser as a download — we want the raw `Response` for headers
 * and `blob()`, not parsed JSON.
 */

export const DELETE_CONFIRMATION_PHRASE = "delete my account and all data";

export interface DeleteAccountResponse {
  ok: boolean;
  deleted_user_id: string;
  household_deleted: boolean;
}

export interface ExportDownload {
  blob: Blob;
  filename: string;
}

/** Parse the `filename="..."` portion of a Content-Disposition header. */
export function parseContentDispositionFilename(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  // Prefer RFC 5987 `filename*=UTF-8''…` if present.
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      // Fall through to the plain `filename=` parse.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

function getToken(): string {
  if (typeof window === "undefined") {
    throw new Error("me.ts must be called from the browser");
  }
  const token = window.localStorage.getItem("token");
  if (!token) throw new Error("Not authenticated");
  return token;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build an axios-shaped error so callers can use `toastApiError` consistently
 * with the rest of the app (which assumes axios `error.response.data.detail`).
 */
async function buildHttpError(resp: Response, method: string, url: string): Promise<Error> {
  let detail: unknown = undefined;
  let dataText = "";
  try {
    dataText = await resp.text();
    if (dataText) {
      try {
        const parsed = JSON.parse(dataText);
        detail = parsed?.detail ?? parsed;
      } catch {
        detail = dataText;
      }
    }
  } catch {
    // Reading the body can fail if it was already consumed; ignore.
  }
  const detailMessage =
    typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `HTTP ${resp.status}`;
  const err = new Error(detailMessage) as Error & {
    response?: { status: number; statusText: string; data: { detail: unknown } | unknown };
    config?: { method: string; url: string };
  };
  err.response = {
    status: resp.status,
    statusText: resp.statusText,
    data: detail !== undefined ? { detail } : dataText,
  };
  err.config = { method, url };
  return err;
}

export const meApi = {
  /**
   * Fetch the user's full data export.
   * Returns the body as a Blob along with the server-suggested filename.
   * Caller is responsible for triggering the actual browser download.
   */
  async exportData(): Promise<ExportDownload> {
    const token = getToken();
    const url = "/api/me/export";
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw await buildHttpError(resp, "GET", url);
    }
    const blob = await resp.blob();
    const fromHeader = parseContentDispositionFilename(resp.headers.get("content-disposition"));
    const filename = fromHeader || `clarity-export-${isoDate()}.json`;
    return { blob, filename };
  },

  /** Delete the user's account. Server requires the confirmation phrase. */
  async deleteAccount(): Promise<DeleteAccountResponse> {
    const token = getToken();
    const url = "/api/me";
    const resp = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm: DELETE_CONFIRMATION_PHRASE }),
    });
    if (!resp.ok) {
      throw await buildHttpError(resp, "DELETE", url);
    }
    return (await resp.json()) as DeleteAccountResponse;
  },
};
