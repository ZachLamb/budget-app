import type { NextConfig } from "next";

// Rewrite destination must be reachable from where Next.js runs.
// Docker Compose sets NEXT_PUBLIC_API_DOCKER=1 so we use http://backend:8000.
// When running frontend on host (npm run dev), "backend" won't resolve → we use http://localhost:8000.
function getApiRewriteDestination(): string {
  const url = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const useDockerBackend = process.env.NEXT_PUBLIC_API_DOCKER === "1";
  if (url.includes("backend") && !useDockerBackend) {
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
};

export default nextConfig;
