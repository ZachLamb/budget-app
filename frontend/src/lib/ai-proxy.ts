import { NextRequest } from "next/server";

/** Cap proxy payload size to reduce abuse of the BFF routes. */
export const MAX_AI_PROXY_BODY_BYTES = 512 * 1024;

export function getAiBackendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_DOCKER === "1"
    ? "http://backend:8000"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

export async function readProxyJsonBody(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const cl = req.headers.get("content-length");
  if (cl !== null && cl !== "") {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_AI_PROXY_BODY_BYTES) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ detail: "Request body too large" }), {
          status: 413,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return {
      ok: false,
      response: new Response(JSON.stringify({ detail: "Could not read request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  if (text.length > MAX_AI_PROXY_BODY_BYTES) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ detail: "Request body too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: new Response(JSON.stringify({ detail: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
}
