"use client";

/**
 * Consistent loading / error / empty UI for React Query-backed sections.
 * Pair with `meta: { inlineError: true }` on the query so the global
 * QueryCache handler does not also toast (see providers.tsx).
 */

import type { ReactNode } from "react";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { ErrorState } from "./error-state";

export interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  /** When true, render empty UI instead of children. */
  isEmpty?: boolean;
  onRetry?: () => void;
  showSettingsLinkOnError?: boolean;
  loadingFallback: ReactNode;
  emptyTitle?: string;
  emptyDescription?: EmptyStateProps["description"];
  emptyAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty = false,
  onRetry,
  showSettingsLinkOnError,
  loadingFallback,
  emptyTitle,
  emptyDescription = "Nothing here yet.",
  emptyAction,
  children,
  className,
}: QueryStateProps) {
  if (isLoading) {
    return <>{loadingFallback}</>;
  }
  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={onRetry}
        showSettingsLink={showSettingsLinkOnError}
        className={className}
      />
    );
  }
  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }
  return <>{children}</>;
}

/** Use on useQuery options when the UI shows QueryState / ErrorState. */
export const inlineErrorQueryMeta = { inlineError: true as const };
