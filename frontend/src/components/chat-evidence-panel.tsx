"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatEvidenceItem } from "@/lib/ai-evidence";
import { formatCurrency } from "@/lib/format";

export function ChatEvidencePanel({ items }: { items: ChatEvidenceItem[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2 mt-2 w-full min-w-0" data-testid="chat-evidence-panel">
      {items.map((ev, i) =>
        ev.type === "category_spending" ? (
          <Card key={i} className="border-dashed bg-muted/30">
            <CardHeader className="py-2 pb-0 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Top spending ({ev.month})
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-3 text-sm">
              {ev.lines.length === 0 ? (
                <p className="text-xs text-muted-foreground">No categorized spending this month yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {ev.lines.slice(0, 8).map((line, j) => (
                    <li key={j} className="flex justify-between gap-2">
                      <span className="truncate">{line.category}</span>
                      <span className="tabular-nums shrink-0">{formatCurrency(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null
      )}
    </div>
  );
}
