import { useMemo, useState, useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup, type Category } from "@/lib/api/categories";
import { configApi, type AppConfig } from "@/lib/api/config";
import { isDemoMode as buildTimeDemoMode } from "@/lib/demo-mode";
import { useAuth } from "@/lib/providers";
import { resolveChartSeriesColors } from "@/lib/ux-plan-logic";

const noopSubscribe = () => () => {};

/** True in browser after hydration; use to defer API-dependent queries to client-only and avoid SSR requests to backend. */
export function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export interface FlatCategory extends Category {
  groupName: string;
}

export function useFlatCategories() {
  const isClient = useIsClient();
  const { data: groups = [] } = useQuery({
    queryKey: ["categoryGroups"],
    queryFn: categoriesApi.listGroups,
    enabled: isClient,
  });

  const allCategories = useMemo(
    () =>
      groups.flatMap((g: CategoryGroup) =>
        g.categories.map((c) => ({ ...c, groupName: g.name }))
      ),
    [groups]
  );

  const catNameMap = useMemo(
    () =>
      Object.fromEntries(
        allCategories.map((c) => [c.id, `${c.groupName} > ${c.name}`])
      ),
    [allCategories]
  );

  return { groups, allCategories, catNameMap };
}

type AxiosLikeDetail =
  | string
  | Array<{ msg?: string; loc?: (string | number)[] }>;

type AxiosLikeError = {
  response?: { data?: { detail?: AxiosLikeDetail } };
};

function axiosDetail(error: unknown): AxiosLikeDetail | undefined {
  if (error === null || typeof error !== "object" || !("response" in error)) return undefined;
  const r = (error as AxiosLikeError).response?.data?.detail;
  return r;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = axiosDetail(error);
  if (detail === undefined) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    const msg = first?.msg ?? first?.loc?.join(" ") ?? JSON.stringify(first);
    return String(msg);
  }
  return fallback;
}

/**
 * Server-sourced app config (demo_mode, auth_methods).
 *
 * The backend is authoritative — prefer this over NEXT_PUBLIC_DEMO_MODE
 * (which is baked at build time and drifts from runtime state). Staled
 * long because this value changes only on a deploy/restart and misses
 * would trigger re-fetches across the tree.
 */
function useAppConfig() {
  const isClient = useIsClient();
  return useQuery<AppConfig>({
    queryKey: ["appConfig"],
    queryFn: configApi.get,
    enabled: isClient,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Single source of truth for "is this UI currently rendering against a
 * demo backend?" — server-authoritative.
 *
 * Returns a stable object with:
 *   - `isDemo`: the server's view of DEMO_MODE (falls back to the
 *     build-time `NEXT_PUBLIC_DEMO_MODE` until the query resolves, so
 *     consumers don't flash "full UI" for one frame on demo deploys).
 *   - `loading`: whether the server truth is still pending.
 *   - `readOnlyMessage`: canonical copy for disabled controls /
 *     tooltip text so every surface uses the same wording.
 */
export function useDemoGuard() {
  const { data, isLoading } = useAppConfig();
  const { user } = useAuth();
  // Read-only applies only to the demo account, not to admins/owners on a
  // demo-enabled backend. Fall back to build-time flag before auth resolves.
  const isDemo = user ? (user.is_demo_user ?? false) : buildTimeDemoMode;
  return {
    isDemo,
    // Server-wide flag: used by the login page to show "Try the Demo" button.
    serverDemoMode: data?.demo_mode ?? buildTimeDemoMode,
    loading: isLoading,
    readOnlyMessage:
      "Demo is read-only — run your own copy locally to make changes.",
  } as const;
}

/** Resolved theme --chart-* colors for Recharts (client-only; falls back until mounted). */
export function useChartColors(max = 8): string[] {
  const isClient = useIsClient();
  const [colors, setColors] = useState<string[]>(() =>
    resolveChartSeriesColors(max, () => ""),
  );

  useEffect(() => {
    if (!isClient) return;
    const root = document.documentElement;
    queueMicrotask(() => {
      setColors(
        resolveChartSeriesColors(max, (name) =>
          getComputedStyle(root).getPropertyValue(name),
        ),
      );
    });
  }, [isClient, max]);

  return colors;
}

/** Observe when an element enters the viewport (once). Use to defer heavy queries. */
export function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px", threshold: 0, ...options },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // options intentionally omitted — callers should pass stable rootMargin/threshold
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, options?.root, options?.rootMargin, options?.threshold]);

  return { ref, inView };
}
