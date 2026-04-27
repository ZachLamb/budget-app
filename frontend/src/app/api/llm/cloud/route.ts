import { NextRequest } from "next/server";
import { getAiBackendBaseUrl, readProxyJsonBody } from "@/lib/ai-proxy";

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

  const auth = req.headers.get("Authorization") ?? "";
  const BACKEND = getAiBackendBaseUrl();

  const upstream = await fetch(`${BACKEND}/api/llm/cloud`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(parsed.body),
  });

  if (!upstream.ok) {
    return new Response(upstream.body, {
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
