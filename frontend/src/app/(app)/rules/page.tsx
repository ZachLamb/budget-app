"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rulesApi, type Rule, type RuleCreate, type RuleSuggestion } from "@/lib/api/rules";
import { reportsApi, type LlmSuggestion } from "@/lib/api/reports";
import { useCategorizeSuggestions } from "@/hooks/use-categorize-suggestions";
import { useMerchantNameRefine } from "@/hooks/use-merchant-name-refine";
import { useFlatCategories, useIsClient } from "@/lib/hooks";
import { toastApiError } from "@/lib/toast-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Sparkles, Play, Check, X } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonTable } from "@/components/skeleton-table";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { MaybeAiErrorWithSettings } from "@/components/llm/ai-error-with-settings";
import { AiRunStatus } from "@/components/llm/ai-run-status";
import { cn } from "@/lib/utils";

const MATCH_FIELDS = [
  { value: "payee", label: "Payee" },
  { value: "notes", label: "Notes" },
  { value: "amount", label: "Amount" },
];

const MATCH_TYPES = [
  { value: "contains", label: "Contains" },
  { value: "exact", label: "Exact" },
  { value: "regex", label: "Regex" },
];

function RulesContent() {
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<LlmSuggestion[]>([]);
  const [form, setForm] = useState<RuleCreate>({
    match_field: "payee",
    match_type: "contains",
    match_value: "",
    category_id: "",
    priority: 0,
  });

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const { data: rules = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["rules"],
    queryFn: rulesApi.list,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const { allCategories, catNameMap } = useFlatCategories();
  const categorizeAi = useCategorizeSuggestions();

  // Rule suggestions derived deterministically from categorization history
  // (payees consistently filed under one category with no rule yet).
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  // On-device AI refinements of the match value (keyed by the original payee name).
  const [refinedMatch, setRefinedMatch] = useState<Record<string, string>>({});
  const nameRefine = useMerchantNameRefine();
  const { data: ruleSuggestions = [] } = useQuery({
    queryKey: ["ruleSuggestions"],
    queryFn: rulesApi.suggestions,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });
  const visibleSuggestions = ruleSuggestions.filter(
    (s: RuleSuggestion) => !dismissedSuggestions.has(s.match_value),
  );
  const matchValueFor = (s: RuleSuggestion) => refinedMatch[s.match_value] ?? s.match_value;

  const refineSuggestions = async () => {
    const accepted = await nameRefine.refine(
      visibleSuggestions.map((s: RuleSuggestion) => ({
        id: s.match_value,
        sourceText: s.match_value,
        current: matchValueFor(s),
      })),
    );
    if (Object.keys(accepted).length > 0) {
      setRefinedMatch((prev) => ({ ...prev, ...accepted }));
    }
  };

  const addSuggestionMutation = useMutation({
    mutationFn: (s: RuleSuggestion) =>
      rulesApi.create({
        match_field: s.match_field,
        match_type: s.match_type,
        match_value: matchValueFor(s),
        category_id: s.category_id,
        source: "history",
      }),
    onSuccess: (_res, s) => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      queryClient.invalidateQueries({ queryKey: ["ruleSuggestions"] });
      appToast.success(`Rule added: ${matchValueFor(s)} → ${s.category_name}`);
    },
    onError: (e) => toastApiError("Failed to add rule", e),
  });

  const createMutation = useMutation({
    mutationFn: rulesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      appToast.success("Rule created");
      setAddOpen(false);
    },
    onError: (e) => toastApiError("Failed to create rule", e),
  });

  const deleteMutation = useMutation({
    mutationFn: rulesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      appToast.success("Rule deleted");
    },
    onError: (e) => toastApiError("Failed to delete rule", e),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => rulesApi.update(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  const applyRulesMutation = useMutation({
    mutationFn: reportsApi.applyRules,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      appToast.success("Rules applied to uncategorized transactions");
    },
    onError: (e) => toastApiError("Failed to apply rules", e),
  });

  const suggestMutation = useMutation({
    mutationFn: () => categorizeAi.suggest(),
    onSuccess: (suggestions) => {
      setSuggestions(suggestions);
      setSuggestOpen(true);
      if (suggestions.length === 0) {
        appToast.info("No uncategorized transactions to suggest for");
      }
    },
    onError: () => {
      // Hook shows inline error + notification bell; block global mutation toast.
    },
  });

  const applySuggestionsMutation = useMutation({
    mutationFn: reportsApi.applySuggestions,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      appToast.success(`Applied ${data.applied} suggestions`);
      setSuggestOpen(false);
    },
  });

  const categorizeBusy = categorizeAi.loading || suggestMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auto-Categorization Rules"
        description="Match payees, notes, or amounts and assign categories automatically."
        actions={
          <>
          <Button variant="outline" onClick={() => applyRulesMutation.mutate()} disabled={applyRulesMutation.isPending}>
            <Play className="mr-2 h-4 w-4" /> Run Rules
          </Button>
          <Button
            variant="outline"
            onClick={() => suggestMutation.mutate()}
            disabled={categorizeBusy}
            aria-busy={categorizeBusy}
          >
            <Sparkles className={cn("mr-2 h-4 w-4", categorizeBusy && "animate-pulse")} />{" "}
            {categorizeBusy ? "Suggesting…" : "AI Suggest"}
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Add Rule</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Rule</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Match Field</Label>
                    <Select value={form.match_field} onValueChange={(v) => setForm({ ...form, match_field: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MATCH_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Match Type</Label>
                    <Select value={form.match_type} onValueChange={(v) => setForm({ ...form, match_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MATCH_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Match Value</Label>
                  <Input value={form.match_value} onChange={(e) => setForm({ ...form, match_value: e.target.value })} placeholder="e.g. Starbucks" />
                </div>
                <div className="space-y-2">
                  <Label>Assign Category</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {allCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.groupName} &gt; {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending || !form.match_value || !form.category_id}>Add Rule</Button>
              </form>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {(categorizeAi.error || categorizeAi.tier) && (
        <div className="flex flex-wrap items-center gap-2">
          {categorizeAi.error ? (
            <MaybeAiErrorWithSettings message={categorizeAi.error} />
          ) : null}
          {categorizeAi.tier ? (
            <Badge variant="secondary" className="text-xs">
              {categorizeAi.tier === 1 ? "On-device (Nano)" : "On-device (WebGPU)"}
            </Badge>
          ) : null}
        </div>
      )}

      {categorizeBusy ? (
        <AiRunStatus
          progress={
            categorizeAi.batchProgress && categorizeAi.batchProgress.total > 0
              ? null
              : categorizeAi.progress
          }
          batch={categorizeAi.batchProgress}
          onCancel={categorizeAi.cancel}
        />
      ) : null}

      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>AI Category Suggestions</DialogTitle></DialogHeader>
          {suggestions.length === 0 ? (
            <p className="text-muted-foreground py-4">No suggestions available.</p>
          ) : (
            <div className="space-y-4">
              <div className="max-h-96 overflow-auto space-y-2">
                {suggestions.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded border px-3 py-2">
                    <div>
                      <span className="font-medium">{s.payee_name}</span>
                      <span className="mx-2 text-muted-foreground">&rarr;</span>
                      <Badge variant="secondary">{s.category_name}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSuggestions(suggestions.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="w-full"
                onClick={() => applySuggestionsMutation.mutate(
                  suggestions.map((s) => ({ transaction_id: s.transaction_id, category_id: s.suggested_category_id }))
                )}
                disabled={applySuggestionsMutation.isPending}
              >
                <Check className="mr-2 h-4 w-4" /> Apply {suggestions.length} Suggestions
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Rule"
        description="This will permanently delete this auto-categorization rule."
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
      />

      {visibleSuggestions.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Suggested from your history</h2>
                <p className="text-xs text-muted-foreground">
                  Payees you consistently categorize the same way, with no rule yet. Add one to automate it going forward.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 gap-1 text-xs"
                onClick={() => void refineSuggestions()}
                disabled={nameRefine.loading}
                aria-busy={nameRefine.loading}
              >
                <Sparkles className={cn("h-3 w-3", nameRefine.loading && "animate-pulse")} />
                {nameRefine.loading ? "Cleaning…" : "Clean names with AI"}
              </Button>
            </div>
            {nameRefine.error && <MaybeAiErrorWithSettings message={nameRefine.error} />}
            <div className="space-y-2">
              {visibleSuggestions.map((s: RuleSuggestion) => {
                const matchValue = matchValueFor(s);
                const refined = matchValue !== s.match_value;
                return (
                <div
                  key={s.match_value}
                  className="flex items-center justify-between gap-2 rounded border bg-background/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="font-medium truncate">{matchValue}</span>
                    {refined && (
                      <Badge variant="outline" className="ml-2 text-[10px] uppercase">AI</Badge>
                    )}
                    <span className="mx-2 text-muted-foreground">&rarr;</span>
                    <Badge variant="secondary">{s.category_name}</Badge>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {s.support} of {s.total} transaction{s.total === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => addSuggestionMutation.mutate(s)}
                      disabled={addSuggestionMutation.isPending}
                    >
                      <Plus className="h-3 w-3" /> Add rule
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Dismiss suggestion for ${s.match_value}`}
                      onClick={() =>
                        setDismissedSuggestions((prev) => new Set(prev).add(s.match_value))
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <QueryState
            isLoading={isLoading && !rules.length}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            isEmpty={!isLoading && rules.length === 0}
            emptyTitle="No rules yet"
            emptyDescription="Add a rule to auto-categorize transactions, or use AI Suggest for ideas."
            emptyAction={
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add rule
              </Button>
            }
            loadingFallback={<SkeletonTable rows={4} columns={7} />}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule: Rule) => (
                  <TableRow key={rule.id} className={!rule.enabled ? "opacity-50" : ""}>
                    <TableCell className="font-mono">{rule.priority}</TableCell>
                    <TableCell className="capitalize">{rule.match_field}</TableCell>
                    <TableCell className="capitalize">{rule.match_type}</TableCell>
                    <TableCell className="font-mono text-sm max-w-48 truncate">{rule.match_value}</TableCell>
                    <TableCell>{catNameMap[rule.category_id] || rule.category_id}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{rule.source}</Badge></TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                      >
                        {rule.enabled ? <Badge className="bg-green-100 text-green-800 hover:bg-green-200">On</Badge> : <Badge variant="secondary">Off</Badge>}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteId(rule.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RulesPage() {
  return <RulesContent />;
}
