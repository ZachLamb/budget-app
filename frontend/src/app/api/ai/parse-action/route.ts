import { NextRequest } from "next/server";
import { getAiBackendBaseUrl, readProxyJsonBody } from "@/lib/ai-proxy";

export async function POST(req: NextRequest) {
  const parsed = await readProxyJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const auth = req.headers.get("Authorization") ?? "";
  const BACKEND = getAiBackendBaseUrl();

  const upstream = await fetch(`${BACKEND}/api/ai/parse-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(parsed.body),
  });

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
