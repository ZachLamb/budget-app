import { NextRequest } from "next/server";

/** Cap proxy payload size to reduce abuse of the BFF routes. */
const MAX_AI_PROXY_BODY_BYTES = 512 * 1024;

/** Upstream deadline for the small, non-streaming action proxies. */
export const ACTION_UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Upstream deadline for the streaming generate proxy. Just under the route's
 * `maxDuration` (300s) so we return a real 504 instead of the platform killing
 * the function with an opaque error.
 */
export const STREAM_UPSTREAM_TIMEOUT_MS = 290_000;

function jsonResponse(status: number, detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function getAiBackendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_DOCKER === "1"
    ? "http://backend:8000"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

/**
 * Forward auth-relevant headers to the backend.
 *
 * - ``Authorization``: legacy Bearer token. Still supported during the
 *   localStorage→cookie migration.
 * - ``Cookie``: carries the new ``session`` httpOnly cookie. The browser
 *   sets it on requests to /api/* (same-origin); the proxy must forward
 *   it verbatim or the backend will treat the request as anonymous.
 * - ``Origin``: required by the backend's ``OriginCheckMiddleware`` for
 *   cookie-authenticated state-changing requests. Forward what the
 *   browser sent so the allowlist check passes.
 */
export function buildForwardHeaders(req: { headers: Headers }): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("Authorization");
  if (auth) out.Authorization = auth;
  const cookie = req.headers.get("Cookie");
  if (cookie) out.Cookie = cookie;
  const origin = req.headers.get("Origin");
  if (origin) out.Origin = origin;
  const referer = req.headers.get("Referer");
  if (referer) out.Referer = referer;
  return out;
}

export async function readProxyJsonBody(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const cl = req.headers.get("content-length");
  if (cl !== null && cl !== "") {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_AI_PROXY_BODY_BYTES) {
      return { ok: false, response: jsonResponse(413, "Request body too large") };
    }
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonResponse(400, "Could not read request body") };
  }

  if (text.length > MAX_AI_PROXY_BODY_BYTES) {
    return { ok: false, response: jsonResponse(413, "Request body too large") };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonResponse(400, "Invalid JSON") };
  }
}

/**
 * Translate a failed upstream `fetch` into a JSON response the client can
 * actually parse.
 *
 * Without this, an unreachable backend rejects the route handler and Next
 * returns its own HTML 500 — every client error path in the app reads
 * `{ detail }`, so the user would see a generic "Cloud AI is unavailable"
 * with no way to tell a dead backend from a refused request.
 */
export function upstreamErrorResponse(req: NextRequest, error: unknown): Response {
  // The browser hung up (user pressed Stop, navigated away). Nobody is left to
  // read this; 499 keeps it out of the 5xx error budget.
  if (req.signal.aborted) {
    return jsonResponse(499, "Request cancelled.");
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return jsonResponse(504, "The AI backend took too long to respond.");
  }
  return jsonResponse(502, "Could not reach the AI backend.");
}

export type UpstreamResult =
  | { ok: true; upstream: Response }
  | { ok: false; response: Response };

/**
 * POST a JSON body to the backend on behalf of the browser.
 *
 * Forwards the client's abort signal so pressing Stop actually cancels the
 * upstream generation instead of leaving the model server (and this function)
 * running to completion, and bounds the wait with `timeoutMs`.
 */
export async function postToBackend(
  path: string,
  req: NextRequest,
  body: unknown,
  { timeoutMs }: { timeoutMs: number },
): Promise<UpstreamResult> {
  try {
    const upstream = await fetch(`${getAiBackendBaseUrl()}${path}`, {
      method: "POST",
      headers: buildForwardHeaders(req),
      body: JSON.stringify(body),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]),
      cache: "no-store",
    });
    return { ok: true, upstream };
  } catch (error) {
    return { ok: false, response: upstreamErrorResponse(req, error) };
  }
}

/** Read upstream response as JSON; avoids throwing when the backend returns HTML or an empty body. */
export async function readUpstreamJsonSafe(upstream: Response): Promise<unknown> {
  const text = await upstream.text();
  if (!text.trim()) {
    return upstream.ok ? {} : { detail: `Request failed (${upstream.status})` };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      detail: text.length > 280 ? `${text.slice(0, 280)}…` : text || `Request failed (${upstream.status})`,
    };
  }
}
