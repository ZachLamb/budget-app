import { NextRequest } from "next/server";
import {
  ACTION_UPSTREAM_TIMEOUT_MS,
  postToBackend,
  readProxyJsonBody,
  readUpstreamJsonSafe,
} from "@/lib/ai-proxy";

export async function POST(req: NextRequest) {
  const parsed = await readProxyJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const result = await postToBackend("/api/ai/prepare-action", req, parsed.body, {
    timeoutMs: ACTION_UPSTREAM_TIMEOUT_MS,
  });
  if (!result.ok) return result.response;

  const data = await readUpstreamJsonSafe(result.upstream);
  return new Response(JSON.stringify(data), {
    status: result.upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
