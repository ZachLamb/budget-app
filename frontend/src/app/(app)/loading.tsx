import { SkeletonCard } from "@/components/skeleton-table";

export default function AppLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page">
      <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
