import { NextRequest } from "next/server";
import {
  postToBackend,
  readProxyJsonBody,
  readUpstreamJsonSafe,
  STREAM_UPSTREAM_TIMEOUT_MS,
} from "@/lib/ai-proxy";

/**
 * Proxy POST /api/llm/cloud → backend FastAPI route. Pass SSE through.
 *
 * Vercel doesn't reliably stream Next.js rewrites (especially long-lived SSE),
 * so we explicitly forward the body and return upstream.body as the response.
 * Edge runtime would be ideal but Vercel limits Edge function duration to 25s
 * on Hobby — Node runtime gives us up to 300s.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const parsed = await readProxyJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const result = await postToBackend("/api/llm/cloud", req, parsed.body, {
    timeoutMs: STREAM_UPSTREAM_TIMEOUT_MS,
  });
  if (!result.ok) return result.response;

  const { upstream } = result;

  // Error responses are JSON, not SSE. Normalize them so the client's
  // `res.json()` always succeeds — a raw pass-through mislabels an HTML or
  // empty upstream error body as application/json.
  if (!upstream.ok) {
    const data = await readUpstreamJsonSafe(upstream);
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
