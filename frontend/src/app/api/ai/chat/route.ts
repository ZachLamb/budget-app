import { NextRequest } from "next/server";

const BACKEND =
  process.env.NEXT_PUBLIC_API_DOCKER === "1"
    ? "http://backend:8000"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const auth = req.headers.get("Authorization") ?? "";

  const upstream = await fetch(`${BACKEND}/api/ai/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
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
