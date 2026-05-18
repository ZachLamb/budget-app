"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  budgetApi,
  type GroupBudgetRow,
  type CategoryBudgetRow,
  type BudgetMonthResponse,
} from "@/lib/api/budget";
import { aiApi, type SpendingTrend, type BudgetSuggestion } from "@/lib/api/ai";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquare,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Lightbulb,
  Cpu,
  Check,
  X,
  Edit2,
  WifiOff,
  Settings,
} from "lucide-react";
import { appToast } from "@/lib/app-toast";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCurrency, getMonthString, formatMonthDisplay, navigateMonth } from "@/lib/format";
import { getApiErrorMessage, useIsClient } from "@/lib/hooks";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { AI_COPY } from "@/lib/ai-copy";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonTable } from "@/components/skeleton-table";

function AssignedCell({
  categoryId,
  month,
  value,
}: {
  categoryId: string;
  month: string;
  value: number;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: budgetApi.assign,
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ["budget", month] });
      const previous = queryClient.getQueryData(["budget", month]);
      queryClient.setQueryData(["budget", month], (old: BudgetMonthResponse | undefined) => {
        if (!old) return old;
        return {
          ...old,
          groups: old.groups.map((g) => ({
            ...g,
            categories: g.categories.map((c) =>
              c.category_id === newData.category_id
                ? { ...c, assigned: newData.assigned_amount, available: newData.assigned_amount + c.activity }
                : c
            ),
          })),
        };
      });
      return { previous };
    },
    onError: (e, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["budget", month], context.previous);
      }
      toastApiError("Failed to save budget", e);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["budget", month] });
    },
  });

  const startEdit = useCallback(() => {
    setDraft(value === 0 ? "" : String(value));
    setEditing(true);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(draft);
    const newValue = isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
    if (newValue !== value) {
      mutation.mutate({
        category_id: categoryId,
        month,
        assigned_amount: newValue,
      });
    }
  }, [draft, value, categoryId, month, mutation]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        step="0.01"
        className="h-7 w-28 text-right font-mono text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className="h-7 w-28 rounded-md border border-transparent px-2 text-right font-mono text-sm hover:border-border hover:bg-muted transition-colors"
    >
      {formatCurrency(value)}
    </button>
  );
}

function CategoryRow({
  cat,
  month,
}: {
  cat: CategoryBudgetRow;
  month: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-4 py-1.5 hover:bg-muted/50 transition-colors">
      <span className="pl-6 text-sm truncate">{cat.category_name}</span>
      <AssignedCell
        categoryId={cat.category_id}
        month={month}
        value={cat.assigned}
      />
      <span className="w-28 text-right font-mono text-sm text-muted-foreground">
        {formatCurrency(cat.activity)}
      </span>
      <span
        className={cn(
          "w-28 text-right font-mono text-sm font-medium",
          cat.available > 0 && "text-green-600",
          cat.available < 0 && "text-red-600",
          cat.available === 0 && "text-muted-foreground"
        )}
      >
        {formatCurrency(cat.available)}
      </span>
    </div>
  );
}

function GroupSection({
  group,
  month,
}: {
  group: GroupBudgetRow;
  month: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-4 py-2.5 hover:bg-accent/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-semibold text-sm">{group.group_name}</span>
        </div>
        <span className="w-28 text-right font-mono text-sm font-medium">
          {formatCurrency(group.assigned)}
        </span>
        <span className="w-28 text-right font-mono text-sm text-muted-foreground">
          {formatCurrency(group.activity)}
        </span>
        <span
          className={cn(
            "w-28 text-right font-mono text-sm font-medium",
            group.available > 0 && "text-green-600",
            group.available < 0 && "text-red-600",
            group.available === 0 && "text-muted-foreground"
          )}
        >
          {formatCurrency(group.available)}
        </span>
      </button>
      {!collapsed &&
        group.categories.map((cat) => (
          <CategoryRow key={cat.category_id} cat={cat} month={month} />
        ))}
    </div>
  );
}

function TrendIcon({ trend }: { trend: SpendingTrend["trend"] }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-red-500 shrink-0" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-green-500 shrink-0" />;
  return <Minus className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function AiSuggestionsPanel({
  month,
  suggestions,
  onDismiss,
}: {
  month: string;
  suggestions: BudgetSuggestion[];
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const assignMutation = useMutation({
    mutationFn: budgetApi.assign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget", month] });
    },
    onError: (e) => toastApiError("Failed to apply suggestion", e),
  });

  const acceptSuggestion = (s: BudgetSuggestion, overrideAmount?: number) => {
    const amount = overrideAmount ?? s.suggested_amount;
    assignMutation.mutate({ category_id: s.category_id, month, assigned_amount: amount });
    setDismissed((prev) => new Set([...prev, s.category_id]));
    setEditing(null);
    appToast.success(`Applied $${amount.toFixed(2)} to ${s.category_name}`);
  };

  const dismissSuggestion = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
  };

  const visible = suggestions.filter((s) => !dismissed.has(s.category_id));

  if (visible.length === 0) {
    onDismiss();
    return null;
  }

  const acceptAll = () => {
    for (const s of visible) {
      assignMutation.mutate({ category_id: s.category_id, month, assigned_amount: s.suggested_amount });
    }
    appToast.success(`Applied ${visible.length} budget suggestions`);
    onDismiss();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI Budget Suggestions
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={acceptAll}>
              <Check className="mr-1 h-3 w-3" /> Accept All
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDismiss}>
              <X className="mr-1 h-3 w-3" /> Dismiss All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground">{AI_COPY.educationalDisclaimer} Suggestions are model-generated from history—not a guarantee of affordability.</p>
        {visible.map((s) => (
          <div key={s.category_id} className="flex items-start gap-3 rounded-lg border p-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{s.category_name}</span>
                {editing === s.category_id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      autoFocus
                      className="h-6 w-24 text-sm font-mono"
                      value={editValues[s.category_id] ?? String(s.suggested_amount)}
                      onChange={(e) =>
                        setEditValues((prev) => ({ ...prev, [s.category_id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = parseFloat(editValues[s.category_id] ?? "");
                          if (!isNaN(v)) acceptSuggestion(s, v);
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  </div>
                ) : (
                  <span className="font-mono text-sm text-primary">
                    {formatCurrency(s.suggested_amount)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{s.reasoning}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-green-600 hover:text-green-700"
                onClick={() => {
                  if (editing === s.category_id) {
                    const v = parseFloat(editValues[s.category_id] ?? "");
                    acceptSuggestion(s, isNaN(v) ? s.suggested_amount : v);
                  } else {
                    acceptSuggestion(s);
                  }
                }}
              >
                <Check className="h-3 w-3 mr-1" /> Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  if (editing === s.category_id) {
                    setEditing(null);
                  } else {
                    setEditing(s.category_id);
                    setEditValues((prev) => ({
                      ...prev,
                      [s.category_id]: String(s.suggested_amount),
                    }));
                  }
                }}
              >
                <Edit2 className="h-3 w-3 mr-1" /> {editing === s.category_id ? "Cancel" : "Edit"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => dismissSuggestion(s.category_id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SpendingPatternsPanel({ month }: { month: string }) {
  const isClient = useIsClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["budgetInsights", month],
    queryFn: aiApi.getBudgetInsights,
    staleTime: 5 * 60 * 1000,
    enabled: isClient && open,
    retry: false,
  });

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          <span className="font-semibold">Spending patterns (optional AI)</span>
          {(data?.model_source === "ollama" || data?.model_source === "demo") && (
            <Badge variant="outline" className="text-xs gap-1 ml-1">
              {data.model_source === "ollama"
                ? <><Cpu className="h-2.5 w-2.5" /> Local AI</>
                : <><Sparkles className="h-2.5 w-2.5" /> Demo</>}
            </Badge>
          )}
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <CardContent className="pt-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            Category trends compare this month to your recent average. Narrative bullets load only when AI is enabled—everything else is plain math.{" "}
            {AI_COPY.educationalDisclaimer}
          </p>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["budgetInsights", month] })}
              disabled={isFetching}
              className="h-7 text-xs"
            >
              <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : isError ? (
            <div className="space-y-2 text-sm">
              <p className="text-destructive flex items-center gap-2">
                <WifiOff className="h-4 w-4 shrink-0" />
                {getApiErrorMessage(error, "Failed to load AI spending insights.")}
              </p>
              {(error as { response?: { status?: number } })?.response?.status === 403 && (
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <Link href="/settings">
                    <Settings className="h-3 w-3 mr-1" /> Enable AI in Settings
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <>
              {data && data.patterns.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Category Trends vs. 3-Month Average
                  </p>
                  <div className="divide-y rounded-md border">
                    {data.patterns.map((p) => (
                      <div key={p.category} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="truncate">{p.category}</span>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          <TrendIcon trend={p.trend} />
                          <span className={cn(
                            "font-mono text-xs w-14 text-right",
                            p.pct_change > 5 ? "text-red-500" : p.pct_change < -5 ? "text-green-500" : "text-muted-foreground"
                          )}>
                            {p.pct_change > 0 ? "+" : ""}{p.pct_change.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data && data.insights.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    AI Insights
                  </p>
                  <ul className="space-y-2">
                    {data.insights.map((insight, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data && data.patterns.length === 0 && data.insights.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No spending data yet, or AI backend unavailable.
                </p>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function BudgetContent() {
  const [month, setMonth] = useState(() => getMonthString(new Date()));
  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<BudgetSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["budget", month],
    queryFn: () => budgetApi.getMonth(month),
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const copyMutation = useMutation({
    mutationFn: () => budgetApi.copyMonth(navigateMonth(month, -1), month),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      appToast.success(`Copied ${result.copied} assignments from last month`);
    },
    onError: (e) => toastApiError("No budget data in previous month to copy", e),
  });

  const handleAiSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const result = await aiApi.getBudgetSuggestions();
      if (result.suggestions.length === 0) {
        appToast.info("No suggestions available — make sure you have 3 months of spending data.");
      } else {
        setSuggestions(result.suggestions);
        setShowSuggestions(true);
      }
    } catch (e) {
      toastPlainError(
        getApiErrorMessage(e, "Failed to load AI suggestions. Make sure an AI backend is available."),
      );
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const readyToAssign = (data?.total_income ?? 0) - (data?.total_assigned ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Assign income to categories and track what's available to spend."
        actions={
          <>
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/?ai_open=1&ai_prompt=${encodeURIComponent(
                "Help me understand my spending for this budget month and what to adjust.",
              )}`}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Ask AI
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAiSuggestions}
            disabled={suggestionsLoading}
          >
            <Sparkles className={cn("mr-2 h-4 w-4", suggestionsLoading && "animate-pulse")} />
            {suggestionsLoading ? "Loading..." : "AI Suggestions"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copyMutation.mutate()}
            disabled={copyMutation.isPending}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy Last Month
          </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => navigateMonth(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[10rem] text-center font-semibold sm:w-44">
              {formatMonthDisplay(month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => navigateMonth(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Income</p>
            <p className="text-2xl font-bold font-mono">
              {formatCurrency(data?.total_income ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Assigned</p>
            <p className="text-2xl font-bold font-mono">
              {formatCurrency(data?.total_assigned ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Ready to Assign</p>
            <p
              className={cn(
                "text-2xl font-bold font-mono",
                readyToAssign > 0 && "text-green-600",
                readyToAssign < 0 && "text-red-600"
              )}
            >
              {formatCurrency(readyToAssign)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[34rem]">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b px-4 py-3">
              <span className="text-xs font-medium uppercase text-muted-foreground tracking-wider">
                Category
              </span>
              <span className="w-28 text-right text-xs font-medium uppercase text-muted-foreground tracking-wider">
                Assigned
              </span>
              <span className="w-28 text-right text-xs font-medium uppercase text-muted-foreground tracking-wider">
                Activity
              </span>
              <span className="w-28 text-right text-xs font-medium uppercase text-muted-foreground tracking-wider">
                Available
              </span>
            </div>

            <QueryState
              isLoading={isLoading && !data}
              isError={isError}
              error={error}
              onRetry={() => refetch()}
              isEmpty={!!data && data.groups.length === 0}
              emptyTitle="No categories yet"
              emptyDescription="Create category groups and categories first."
              loadingFallback={
                <div className="px-4 py-6">
                  <SkeletonTable rows={8} columns={4} />
                </div>
              }
            >
              {data?.groups.map((group) => (
                <GroupSection
                  key={group.group_id}
                  group={group}
                  month={month}
                />
              ))}
            </QueryState>
          </div>
        </div>

      </Card>

      {showSuggestions && suggestions.length > 0 && (
        <AiSuggestionsPanel
          month={month}
          suggestions={suggestions}
          onDismiss={() => { setShowSuggestions(false); setSuggestions([]); }}
        />
      )}

      <SpendingPatternsPanel month={month} />
    </div>
  );
}

export default function BudgetPage() {
  return <BudgetContent />;
}
