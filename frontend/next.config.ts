import type { NextConfig } from "next";

// Rewrite destination must be reachable from where Next.js runs.
// Docker Compose sets NEXT_PUBLIC_API_DOCKER=1 so we use http://backend:8000.
// When running frontend on host (npm run dev), "backend" won't resolve → we use http://localhost:8000.
//
// The substring check intentionally targets ONLY the docker-compose internal
// hostname (the literal host "backend", with no domain). Earlier this used
// ``url.includes("backend")`` which also matched legitimate public hostnames
// like "clarity-backend.fly.dev" — Vercel then proxied /api to localhost,
// the loopback resolves to a private IP, and we 404'd with
// DNS_HOSTNAME_RESOLVED_PRIVATE on every request.
function getApiRewriteDestination(): string {
  const url = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const useDockerBackend = process.env.NEXT_PUBLIC_API_DOCKER === "1";
  // Match only http://backend or http://backend:PORT (the compose hostname).
  // Public hostnames that merely contain "backend" no longer collide.
  const isDockerComposeHostname = /^https?:\/\/backend(?::\d+)?(?:\/|$)/.test(url);
  if (isDockerComposeHostname && !useDockerBackend) {
    return "http://localhost:8000";
  }
  return url;
}

const nextConfig: NextConfig = {
  async rewrites() {
    const dest = getApiRewriteDestination();
    return [
      {
        source: "/api/:path*",
        destination: `${dest}/api/:path*`,
      },
    ];
  },
  async headers() {
    // Defense-in-depth headers shipped on every page. Notes:
    //   - HSTS only takes effect over HTTPS; safe to send unconditionally
    //     (browsers ignore it on HTTP). includeSubDomains keeps the policy
    //     valid even if a future deploy splits subdomains; preload would
    //     need an explicit submission to hstspreload.org first.
    //   - CSP is intentionally permissive for inline scripts (Next.js dev
    //     hot-reload + production runtime both inject inline JSON). Move
    //     to nonces in a follow-up if the CSP report endpoint shows abuse.
    //   - Permissions-Policy disables device APIs we don't use. WebGPU is
    //     NOT disabled here — Tier 2 (web-llm) needs it.
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline' for inline JSON snapshots Next.js emits; 'unsafe-eval'
      // is required by web-llm's WASM loader. wasm-unsafe-eval is the right
      // narrower form and is supported by Chrome/Edge/Safari/Firefox.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // web-llm fetches model weights from huggingface.co; LFS files redirect
      // to *.hf.co (xethub CDN). Allow both explicitly.
      "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    const permissionsPolicy = [
      // Affirmatively disable APIs the app doesn't use. Browsers default-deny
      // most of these on cross-origin frames already, but explicit is better.
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "battery=()",
      "camera=()",
      "display-capture=()",
      "document-domain=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "gamepad=()",
      "geolocation=()",
      "gyroscope=()",
      "hid=()",
      "idle-detection=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "publickey-credentials-get=(self)",  // passkeys live here
      "screen-wake-lock=()",
      "serial=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Permissions-Policy", value: permissionsPolicy },
          // Cross-origin isolation enables SharedArrayBuffer + WebGPU buffer sharing for web-llm.
          // `credentialless` lets us still load images/fonts from third parties without CORP.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
