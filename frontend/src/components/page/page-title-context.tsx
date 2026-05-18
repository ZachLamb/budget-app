"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

const PATH_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/budget": "Budget",
  "/transactions": "Transactions",
  "/accounts": "Accounts",
  "/plan": "Plan",
  "/reports": "Reports",
  "/recurring": "Recurring",
  "/categories": "Categories",
  "/payees": "Payees",
  "/rules": "Rules",
  "/settings": "Settings",
};

function titleFromPath(pathname: string): string {
  if (PATH_TITLES[pathname]) return PATH_TITLES[pathname];
  for (const [path, title] of Object.entries(PATH_TITLES)) {
    if (path !== "/" && pathname.startsWith(path)) return title;
  }
  return "Clarity";
}

type PageTitleContextValue = {
  title: string;
  setTitle: (title: string | null) => void;
};

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setOverride(null));
  }, [pathname]);

  const setTitle = useCallback((title: string | null) => {
    setOverride(title);
  }, []);

  const title = override ?? titleFromPath(pathname);

  const value = useMemo(() => ({ title, setTitle }), [title, setTitle]);

  return (
    <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  if (!ctx) {
    return { title: "Clarity", setTitle: () => {} };
  }
  return ctx;
}
