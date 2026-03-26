import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup, type Category } from "@/lib/api/categories";

/** True after mount; use to defer API-dependent queries to client-only and avoid SSR requests to backend. */
export function useIsClient() {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  return isClient;
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

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as any).response?.data?.detail !== undefined
  ) {
    const detail = (error as any).response.data.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      const msg = first?.msg ?? first?.loc?.join(" ") ?? JSON.stringify(first);
      return String(msg);
    }
    return fallback;
  }
  return fallback;
}

const CHART_FALLBACK = [
  "oklch(0.646 0.222 41.116)",
  "oklch(0.6 0.118 184.704)",
  "oklch(0.398 0.07 227.392)",
  "oklch(0.828 0.189 84.429)",
  "oklch(0.769 0.188 70.08)",
];

/** Resolved theme --chart-* colors for Recharts (client-only; falls back until mounted). */
export function useChartColors(max = 8): string[] {
  const isClient = useIsClient();
  const [colors, setColors] = useState<string[]>(() =>
    Array.from({ length: max }, (_, i) => CHART_FALLBACK[i % CHART_FALLBACK.length]),
  );

  useEffect(() => {
    if (!isClient) return;
    const root = document.documentElement;
    const next: string[] = [];
    for (let i = 0; i < max; i++) {
      const n = (i % 5) + 1;
      const raw = getComputedStyle(root).getPropertyValue(`--chart-${n}`).trim();
      next.push(raw || CHART_FALLBACK[i % CHART_FALLBACK.length]);
    }
    setColors(next);
  }, [isClient, max]);

  return colors;
}
