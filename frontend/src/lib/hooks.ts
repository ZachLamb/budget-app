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
