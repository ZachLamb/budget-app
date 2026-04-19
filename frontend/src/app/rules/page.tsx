"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rulesApi, type Rule, type RuleCreate } from "@/lib/api/rules";
import { reportsApi, type LlmSuggestion } from "@/lib/api/reports";
import { useFlatCategories, getApiErrorMessage, useIsClient } from "@/lib/hooks";
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
  const { data: rules = [], isLoading, isError, error } = useQuery({
    queryKey: ["rules"],
    queryFn: rulesApi.list,
    enabled: isClient,
  });

  const { allCategories, catNameMap } = useFlatCategories();

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
    // Wrapped so `.mutate()` is callable with no args — the underlying
    // fetcher accepts optional filters; on this page we always want the
    // "recent uncategorized" default batch.
    mutationFn: () => reportsApi.suggestCategories(),
    onSuccess: (data) => {
      setSuggestions(data.suggestions);
      setSuggestOpen(true);
      if (data.suggestions.length === 0) {
        appToast.info("No uncategorized transactions to suggest for");
      }
    },
    onError: (e) => toastApiError("Failed to get suggestions. Is the API key configured?", e),
  });

  const applySuggestionsMutation = useMutation({
    mutationFn: reportsApi.applySuggestions,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      appToast.success(`Applied ${data.applied} suggestions`);
      setSuggestOpen(false);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Auto-Categorization Rules</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => applyRulesMutation.mutate()} disabled={applyRulesMutation.isPending}>
            <Play className="mr-2 h-4 w-4" /> Run Rules
          </Button>
          <Button variant="outline" onClick={() => suggestMutation.mutate()} disabled={suggestMutation.isPending}>
            <Sparkles className="mr-2 h-4 w-4" /> AI Suggest
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
        </div>
      </div>

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

      <Card>
        <CardContent className="pt-6">
          {isError ? (
            <p className="text-destructive py-4">{getApiErrorMessage(error, "Failed to load rules")}</p>
          ) : isLoading ? (
            <SkeletonTable rows={4} columns={7} />
          ) : (
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
                {rules.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No rules yet. Add one or use AI suggestions.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RulesPage() {
  return <AuthGuard><RulesContent /></AuthGuard>;
}
