import { NextRequest } from "next/server";
import { getAiBackendBaseUrl, readProxyJsonBody } from "@/lib/ai-proxy";

export async function POST(req: NextRequest) {
  const parsed = await readProxyJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const auth = req.headers.get("Authorization") ?? "";
  const BACKEND = getAiBackendBaseUrl();

  const upstream = await fetch(`${BACKEND}/api/ai/chat/stream`, {
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

  // Pass the SSE stream straight through
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
