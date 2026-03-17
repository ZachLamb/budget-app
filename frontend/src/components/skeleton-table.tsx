import { cn } from "@/lib/utils";

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className={cn(
                "h-4 rounded bg-muted animate-pulse",
                c === 0 ? "w-24" : "flex-1"
              )}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading content...</span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border p-6 space-y-4" role="status" aria-label="Loading">
      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
      <div className="h-8 w-24 rounded bg-muted animate-pulse" />
      <span className="sr-only">Loading content...</span>
    </div>
  );
}
