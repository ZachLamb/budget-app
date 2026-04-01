import { useMemo, useState, useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup, type Category } from "@/lib/api/categories";
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
