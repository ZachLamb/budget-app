import { NextRequest } from "next/server";

const BACKEND =
  process.env.NEXT_PUBLIC_API_DOCKER === "1"
    ? "http://backend:8000"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const auth = req.headers.get("Authorization") ?? "";

  const upstream = await fetch(`${BACKEND}/api/ai/parse-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
