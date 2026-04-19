/**
 * Build-time demo flag — baked from `NEXT_PUBLIC_DEMO_MODE` at compile
 * time. Use the server-sourced `useDemoGuard()` hook (see `lib/hooks.ts`)
 * for runtime-accurate state; this constant is kept as a synchronous
 * fallback for code paths that can't await a query (module-top-level,
 * server components, SSR) and as the initial value while the query
 * resolves on first paint.
 */
export const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
