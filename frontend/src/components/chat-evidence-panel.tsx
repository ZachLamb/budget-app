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
        ) : ev.type === "goal_progress" ? (
          <Card key={i} className="border-dashed bg-muted/30">
            <CardHeader className="py-2 pb-0 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">Goal progress</CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-3 text-sm">
              {ev.goals.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active goals.</p>
              ) : (
                <ul className="space-y-1">
                  {ev.goals.slice(0, 8).map((g, j) => (
                    <li key={j} className="flex flex-col gap-0.5">
                      <div className="flex justify-between gap-2">
                        <span className="truncate font-medium">{g.name}</span>
                        <span className="tabular-nums shrink-0 text-xs text-muted-foreground">
                          {Math.round(g.pct_complete)}%
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(g.current_amount)} / {formatCurrency(g.target_amount)}
                        <span className="ml-1">({g.goal_type.replace(/_/g, " ")})</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : ev.type === "budget_pace" ? (
          <Card key={i} className="border-dashed bg-muted/30">
            <CardHeader className="py-2 pb-0 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Budget vs spent ({ev.month})
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-3 text-sm">
              {ev.lines.length === 0 ? (
                <p className="text-xs text-muted-foreground">No budget assignments this month.</p>
              ) : (
                <ul className="space-y-1">
                  {ev.lines.slice(0, 10).map((line, j) => (
                    <li key={j} className="flex flex-col gap-0.5">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{line.category}</span>
                        <span
                          className={
                            line.remaining < 0
                              ? "tabular-nums shrink-0 text-destructive text-xs font-medium"
                              : "tabular-nums shrink-0 text-xs text-muted-foreground"
                          }
                        >
                          {line.remaining < 0 ? `${formatCurrency(-line.remaining)} over` : `${formatCurrency(line.remaining)} left`}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        Spent {formatCurrency(line.spent)} of {formatCurrency(line.budgeted)} budgeted
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null,
      )}
    </div>
  );
}
