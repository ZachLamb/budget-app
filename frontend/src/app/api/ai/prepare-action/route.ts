import { NextRequest } from "next/server";
import { buildForwardHeaders, getAiBackendBaseUrl, readProxyJsonBody, readUpstreamJsonSafe } from "@/lib/ai-proxy";

export async function POST(req: NextRequest) {
  const parsed = await readProxyJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const BACKEND = getAiBackendBaseUrl();

  const upstream = await fetch(`${BACKEND}/api/ai/prepare-action`, {
    method: "POST",
    headers: buildForwardHeaders(req),
    body: JSON.stringify(parsed.body),
  });

  const data = await readUpstreamJsonSafe(upstream);
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
