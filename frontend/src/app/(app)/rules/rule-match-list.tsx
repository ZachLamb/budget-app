"use client";

import { type RuleMatch, type RulePreview } from "@/lib/api/rules";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

/** Highlight the part of the text the rule caught.
 *
 *  Seeing *where* a pattern hit is what turns "47 matches" from a number
 *  into a judgement you can make. Only literal matches are highlighted:
 *  re-running a user's regex in the browser to find the offset would be
 *  a second implementation of the matcher, and a second place for it to
 *  disagree with the server.
 */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-900/60 dark:text-yellow-50">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

export function RuleMatchList({
  preview,
  needle = "",
  emptyMessage = "Nothing matches yet.",
}: {
  preview: RulePreview;
  /** The literal being matched on, for highlighting. Empty for regex. */
  needle?: string;
  emptyMessage?: string;
}) {
  if (preview.total === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const hidden = preview.total - preview.sample.length;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {preview.total} uncategorized transaction{preview.total === 1 ? "" : "s"} would
        be categorized
      </p>
      <ul className="divide-y rounded border">
        {preview.sample.map((m: RuleMatch) => (
          <li
            key={m.transaction_id}
            className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground tabular-nums">
                {formatDate(m.date, { month: "short", day: "numeric" })}
              </span>{" "}
              <Highlighted text={m.matched_on || "—"} needle={needle} />
            </span>
            <span className="shrink-0 tabular-nums">
              {formatCurrency(Number(m.amount))}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          …and {hidden} more. Showing the {preview.sample.length} most recent.
        </p>
      )}
      {/* Said once, here, rather than assumed: this is why running rules is
          always safe to do. */}
      <p className="text-xs text-muted-foreground">
        Only uncategorized transactions are touched — a category you chose
        yourself is never overwritten.
      </p>
    </div>
  );
}

/** A Badge showing a live match count, or why there isn't one yet. */
export function MatchCountBadge({
  preview,
  isFetching,
  error,
}: {
  preview: RulePreview | undefined;
  isFetching: boolean;
  error: unknown;
}) {
  if (error) {
    return (
      <Badge variant="destructive" className="text-xs">
        Can&apos;t check this pattern
      </Badge>
    );
  }
  if (!preview) {
    return isFetching ? (
      <Badge variant="secondary" className="text-xs">Checking…</Badge>
    ) : null;
  }
  return (
    <Badge
      variant={preview.total === 0 ? "outline" : "secondary"}
      className="text-xs"
      // Stale counts while a new one loads read as flicker; dimming says
      // "this number is about to change" without removing it.
      style={isFetching ? { opacity: 0.6 } : undefined}
    >
      {preview.total === 0
        ? "No matches"
        : `${preview.total} match${preview.total === 1 ? "" : "es"}`}
    </Badge>
  );
}
