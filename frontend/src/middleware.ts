import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Server-side gate for authenticated routes. The httpOnly `session` cookie is
 * set by the FastAPI backend; we can't verify its signature here (the signing
 * secret stays on the backend), but a presence check stops unauthenticated
 * deep links from receiving the app shell at all — client-side AuthGuard
 * remains the second layer, and every API call is verified server-side.
 */

const SESSION_COOKIE = "session";

/** Route prefixes reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth", // OAuth callback + magic-link landing handle their own session setup
  "/privacy",
  "/offline",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  // Preserve the intended destination so login can bounce back.
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next internals, static assets, the API proxy (backend authenticates
  // every request itself), and PWA files the browser fetches without cookies.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|icons/|manifest\\.webmanifest|sw\\.js|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)$).*)",
  ],
};
