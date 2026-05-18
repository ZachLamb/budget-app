"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { usePageTitle } from "./page-title-context";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** When false, mobile header keeps pathname fallback only. Default true. */
  syncMobileTitle?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  syncMobileTitle = true,
}: PageHeaderProps) {
  const { setTitle } = usePageTitle();

  useEffect(() => {
    if (!syncMobileTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [title, syncMobileTitle, setTitle]);

  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
