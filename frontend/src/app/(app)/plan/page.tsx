"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { debtApi, type DebtAccount } from "@/lib/api/debt";
import { accountsApi } from "@/lib/api/accounts";
import { aiApi, type DebtPlanSuggestion, type InterestRateSuggestion } from "@/lib/api/ai";
import { goalsApi, type FinancialGoal, type GoalCreate } from "@/lib/api/goals";
import { settingsApi } from "@/lib/api/settings";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatCurrencyNegative } from "@/lib/format";
import { useIsClient, getApiErrorMessage } from "@/lib/hooks";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";
import { cn } from "@/lib/utils";
import {
  TrendingDown, Target, PiggyBank, Shield, Plus, Trash2,
  CheckCircle2, Calculator, Edit2, AlertCircle, Map,
  Sparkles, Loader2, X, Check, RefreshCw,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page";
import { SkeletonTable } from "@/components/skeleton-table";
import { AI_COPY } from "@/lib/ai-copy";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const PLAN_TABS = ["debt", "goals"] as const;
type PlanTab = (typeof PLAN_TABS)[number];

const GOAL_TYPES = [
  { value: "debt_payoff", label: "Debt Payoff", icon: TrendingDown, color: "text-red-500" },
  { value: "savings", label: "Savings", icon: PiggyBank, color: "text-blue-500" },
  { value: "emergency_fund", label: "Emergency Fund", icon: Shield, color: "text-green-500" },
  { value: "custom", label: "Custom Goal", icon: Target, color: "text-purple-500" },
];

type DebtStrategy = "avalanche" | "snowball" | "hybrid";

const STRATEGY_LABELS: Record<DebtStrategy, { label: string; description: string }> = {
  avalanche: {
    label: "Avalanche",
    description:
      "Pay highest-interest debt first. Usually minimizes interest vs snowball, assuming steady payments and accurate APRs.",
  },
  snowball: {
    label: "Snowball",
    description: "Pay smallest balance first. Quick wins for motivation.",
  },
  hybrid: {
    label: "Hybrid",
    description:
      "Highest APR first; when APRs tie (or are unknown), smaller balances come first—blends avalanche focus with snowball tie-breaks.",
  },
};

function mapDebtPriorityNamesToIds(order: string[], accounts: DebtAccount[]): string[] {
  const ids: string[] = [];
  const used = new Set<string>();
  const norm = (s: string) => s.trim().toLowerCase();
  for (const raw of order) {
    const n = norm(raw);
    if (!n) continue;
    const exact = accounts.find((a) => norm(a.name) === n);
    const match =
      exact ??
      accounts.find(
        (a) => !used.has(a.id) && (norm(a.name).includes(n) || n.includes(norm(a.name))),
      );
    if (match && !used.has(match.id)) {
      ids.push(match.id);
      used.add(match.id);
    }
  }
  return ids;
}

// ── Goals sub-components ─────────────────────────────────────────────────────

function GoalIcon({ type }: { type: string }) {
  const gt = GOAL_TYPES.find((t) => t.value === type) ?? GOAL_TYPES[3];
  const Icon = gt.icon;
  return <Icon className={cn("h-5 w-5", gt.color)} />;
}

const EMPTY_GOAL: GoalCreate = {
  name: "",
  description: "",
  goal_type: "savings",
  target_amount: 0,
  current_amount: 0,
  monthly_contribution: undefined,
  target_date: undefined,
  account_id: undefined,
};
const NONE_ACCOUNT_VALUE = "__none__";

function GoalCard({ goal, onDelete, onToggle, onEdit }: {
  goal: FinancialGoal;
  onDelete: () => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const pct = Math.max(0, Math.min(100, Number(goal.progress_pct ?? 0)));
  const remaining = goal.target_amount - goal.current_amount;
  const progressText = goal.goal_type === "debt_payoff"
    ? `${formatCurrency(goal.current_amount)} paid of ${formatCurrency(goal.target_amount)}`
    : `${formatCurrency(goal.current_amount)} of ${formatCurrency(goal.target_amount)}`;
  return (
    <Card className={cn(goal.is_completed && "opacity-60")}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <GoalIcon type={goal.goal_type} />
            <div>
              <p className="font-semibold">{goal.name}</p>
              {goal.description && <p className="text-xs text-muted-foreground">{goal.description}</p>}
            </div>
          </div>
          <Badge variant={goal.is_completed ? "default" : "outline"} className="text-xs">
            {GOAL_TYPES.find((t) => t.value === goal.goal_type)?.label ?? goal.goal_type}
          </Badge>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">
              {progressText}
            </span>
            <span className="font-medium">{pct.toFixed(0)}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex gap-3 text-muted-foreground flex-wrap">
            {remaining > 0 && !goal.is_completed && <span>{formatCurrency(remaining)} to go</span>}
            {goal.monthly_contribution && <span>{formatCurrency(goal.monthly_contribution)}/mo</span>}
            {goal.months_remaining != null && !goal.is_completed && <span>~{goal.months_remaining} months</span>}
            {goal.target_date && (
              <span>By {new Date(goal.target_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 px-2 text-xs">Edit</Button>
            <Button
              variant="ghost" size="sm" onClick={onToggle}
              className={cn("h-7 px-2 text-xs", goal.is_completed ? "text-muted-foreground" : "text-green-600")}
            >
              {goal.is_completed ? "Reopen" : "Mark done"}
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} className="h-7 w-7 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalForm({ accounts, initial, onSave, onCancel, saving }: {
  accounts: { id: string; name: string }[];
  initial: GoalCreate;
  onSave: (data: GoalCreate) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<GoalCreate>(initial);
  const f = (patch: Partial<GoalCreate>) => setForm((p) => ({ ...p, ...patch }));
  const name = form.name.trim();
  const targetError = !Number.isFinite(form.target_amount) || form.target_amount <= 0
    ? "Target must be greater than 0."
    : null;
  const currentError = !Number.isFinite(form.current_amount ?? 0) || (form.current_amount ?? 0) < 0
    ? "Current amount cannot be negative."
    : null;
  const monthlyError = form.monthly_contribution != null
    && (!Number.isFinite(form.monthly_contribution) || form.monthly_contribution < 0)
    ? "Monthly contribution cannot be negative."
    : null;
  const canSave = Boolean(name) && !targetError && !currentError && !monthlyError && !saving;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label>Goal Name</Label>
          <Input value={form.name} onChange={(e) => f({ name: e.target.value })} placeholder="e.g. Pay off Visa card" />
          {!name && <p className="text-xs text-destructive">Goal name is required.</p>}
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={form.goal_type} onValueChange={(v) => f({ goal_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GOAL_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Linked Account (optional)</Label>
          <Select
            value={form.account_id ?? NONE_ACCOUNT_VALUE}
            onValueChange={(v) => f({ account_id: v === NONE_ACCOUNT_VALUE ? undefined : v })}
          >
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_ACCOUNT_VALUE}>None</SelectItem>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Target Amount</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input type="number" step="1" min="0" className="pl-7"
              value={form.target_amount || ""}
              onChange={(e) => f({ target_amount: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </div>
          {targetError && <p className="text-xs text-destructive">{targetError}</p>}
        </div>
        <div className="space-y-2">
          <Label>Current Amount</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input type="number" step="1" min="0" className="pl-7"
              value={form.current_amount || ""}
              onChange={(e) => f({ current_amount: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </div>
          {currentError && <p className="text-xs text-destructive">{currentError}</p>}
        </div>
        <div className="space-y-2">
          <Label>Monthly Contribution</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input type="number" step="10" min="0" className="pl-7" placeholder="optional"
              value={form.monthly_contribution ?? ""}
              onChange={(e) => f({ monthly_contribution: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </div>
          {monthlyError && <p className="text-xs text-destructive">{monthlyError}</p>}
        </div>
        <div className="space-y-2">
          <Label>Target Date (optional)</Label>
          <Input type="date" value={form.target_date ?? ""}
            onChange={(e) => f({ target_date: e.target.value || undefined })} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Description (optional)</Label>
          <Textarea value={form.description ?? ""} onChange={(e) => f({ description: e.target.value })}
            placeholder="Why is this goal important to you?" rows={2} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => canSave && onSave({ ...form, name })}
          disabled={!canSave}
        >
          {saving ? "Saving..." : "Save Goal"}
        </Button>
      </div>
    </div>
  );
}

// ── Goals Tab ─────────────────────────────────────────────────────────────────

function GoalsTab() {
  const isClient = useIsClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<FinancialGoal | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals"],
    queryFn: goalsApi.list,
    enabled: isClient,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });

  const createMutation = useMutation({
    mutationFn: goalsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["goals"] }); appToast.success("Goal created"); setOpen(false); },
    onError: (err) => {
      toastApiError("Failed to create goal", err);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => goalsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["goals"] }); appToast.success("Goal updated"); setEditGoal(null); },
    onError: (err) => {
      toastApiError("Failed to update goal", err);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: goalsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      appToast.success("Goal deleted");
      setDeleteId(null);
    },
    onError: (err) => {
      toastApiError("Failed to delete goal", err);
    },
  });

  const activeGoals = goals.filter((g) => !g.is_completed);
  const completedGoals = goals.filter((g) => g.is_completed);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {goals.length > 0 && (
            <>
              <Badge variant="outline">{activeGoals.length} active</Badge>
              {completedGoals.length > 0 && (
                <Badge variant="outline" className="text-green-600 border-green-200">{completedGoals.length} completed</Badge>
              )}
            </>
          )}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-2 h-4 w-4" /> New Goal</Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Create a Financial Goal</DialogTitle></DialogHeader>
            <GoalForm
              key={open ? "create-goal" : "create-closed"}
              accounts={accounts}
              initial={EMPTY_GOAL}
              onSave={(data) => createMutation.mutate(data)}
              onCancel={() => setOpen(false)}
              saving={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <SkeletonTable rows={3} columns={4} />
      ) : activeGoals.length === 0 && completedGoals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Target className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No goals yet. Create your first goal to get started.</p>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Create Goal</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeGoals.map((g) => (
            <GoalCard key={g.id} goal={g}
              onDelete={() => setDeleteId(g.id)}
              onToggle={() => updateMutation.mutate({ id: g.id, data: { is_completed: true } })}
              onEdit={() => setEditGoal(g)}
            />
          ))}
        </div>
      )}

      {completedGoals.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" /> Completed
          </h3>
          {completedGoals.map((g) => (
            <GoalCard key={g.id} goal={g}
              onDelete={() => setDeleteId(g.id)}
              onToggle={() => updateMutation.mutate({ id: g.id, data: { is_completed: false } })}
              onEdit={() => setEditGoal(g)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!editGoal} onOpenChange={(o) => { if (!o) setEditGoal(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit Goal</DialogTitle></DialogHeader>
          {editGoal && (
            <GoalForm
              key={editGoal.id}
              accounts={accounts}
              initial={{
                name: editGoal.name,
                description: editGoal.description ?? "",
                goal_type: editGoal.goal_type,
                target_amount: editGoal.target_amount,
                current_amount: editGoal.current_amount,
                monthly_contribution: editGoal.monthly_contribution ?? undefined,
                target_date: editGoal.target_date ?? undefined,
                account_id: editGoal.account_id ?? undefined,
              }}
              onSave={(data) => updateMutation.mutate({ id: editGoal.id, data })}
              onCancel={() => setEditGoal(null)}
              saving={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Goal"
        description="This will permanently delete this goal. Your financial data won't be affected."
        loading={deleteMutation.isPending}
        loadingLabel="Deleting…"
        closeOnConfirm={false}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
      />
    </div>
  );
}

// ── Debt Tab ──────────────────────────────────────────────────────────────────

function DebtTab() {
  const isClient = useIsClient();
  const queryClient = useQueryClient();
  const [strategy, setStrategy] = useState<DebtStrategy>("avalanche");
  const [priorityAccountIds, setPriorityAccountIds] = useState<string[] | undefined>(undefined);
  const [extraMonthly, setExtraMonthly] = useState(0);
  const debouncedExtra = useDebounced(extraMonthly, 500);
  const [editAccount, setEditAccount] = useState<DebtAccount | null>(null);
  const [editForm, setEditForm] = useState({ interest_rate: "", minimum_payment: "" });
  const [aiSuggestion, setAiSuggestion] = useState<DebtPlanSuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDismissed, setAiDismissed] = useState(false);

  // Interest rate suggestions
  const [rateSuggestions, setRateSuggestions] = useState<InterestRateSuggestion[]>([]);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateNote, setRateNote] = useState<string | null>(null);
  const [dismissedRates, setDismissedRates] = useState<Set<string>>(new Set());
  const [acceptedRateIds, setAcceptedRateIds] = useState<Set<string>>(new Set());
  const [isAcceptingAll, setIsAcceptingAll] = useState(false);

  // Persistence: track whether user has interacted to avoid overwriting with stale fetch
  const hasUserInteracted = useRef(false);
  const prefsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const aiRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (prefsSaveTimer.current) clearTimeout(prefsSaveTimer.current);
    };
  }, []);

  const { data: debtAccounts = [], isLoading } = useQuery({
    queryKey: ["debtAccounts"],
    queryFn: debtApi.listDebtAccounts,
    enabled: isClient,
  });

  const { data: plan, isFetching: planLoading } = useQuery({
    queryKey: ["payoffPlan", strategy, debouncedExtra, (priorityAccountIds ?? []).join(",")],
    queryFn: () =>
      debtApi.calculatePayoffPlan(
        strategy,
        debouncedExtra,
        strategy === "hybrid" ? priorityAccountIds : undefined,
      ),
    enabled: isClient && debtAccounts.length > 0,
  });

  // Load persisted preferences
  const { data: planPrefs } = useQuery({
    queryKey: ["planPreferences"],
    queryFn: settingsApi.getPlanPreferences,
    enabled: isClient,
  });

  useEffect(() => {
    if (!planPrefs || hasUserInteracted.current) return;
    if (
      planPrefs.debt_strategy === "avalanche" ||
      planPrefs.debt_strategy === "snowball" ||
      planPrefs.debt_strategy === "hybrid"
    ) {
      setStrategy(planPrefs.debt_strategy as DebtStrategy);
    }
    if (planPrefs.debt_extra_monthly != null) {
      setExtraMonthly(planPrefs.debt_extra_monthly);
    }
  }, [planPrefs]);

  const persistPreferences = useCallback((s: DebtStrategy, extra: number) => {
    settingsApi.updatePlanPreferences({
      debt_strategy: s,
      debt_extra_monthly: extra,
    }).catch((err: unknown) => {
      toastApiError("Could not save plan preferences", err);
    });
  }, []);

  const debouncedPersist = useCallback((s: DebtStrategy, extra: number) => {
    if (prefsSaveTimer.current) clearTimeout(prefsSaveTimer.current);
    prefsSaveTimer.current = setTimeout(() => persistPreferences(s, extra), 500);
  }, [persistPreferences]);

  const handleStrategyChange = (v: string) => {
    const val = v as DebtStrategy;
    hasUserInteracted.current = true;
    setStrategy(val);
    if (val !== "hybrid") {
      setPriorityAccountIds(undefined);
    }
    debouncedPersist(val, extraMonthly);
  };

  const handleExtraChange = (v: number) => {
    hasUserInteracted.current = true;
    setExtraMonthly(v);
    debouncedPersist(strategy, v);
  };

  const invalidateDebtQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["debtAccounts"] });
    queryClient.invalidateQueries({ queryKey: ["payoffPlan"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  }, [queryClient]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => accountsApi.update(id, data as Record<string, unknown>),
    onSuccess: () => {
      invalidateDebtQueries();
    },
    onError: (err) => {
      toastApiError("Failed to update account", err);
    },
  });

  const totalDebt = debtAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  const allHaveRates = debtAccounts.length > 0 && debtAccounts.every(
    (a) => a.interest_rate != null && a.minimum_payment != null,
  );

  const openEdit = (acct: DebtAccount) => {
    setEditAccount(acct);
    setEditForm({
      interest_rate: acct.interest_rate != null ? (Number(acct.interest_rate) * 100).toFixed(2) : "",
      minimum_payment: acct.minimum_payment != null ? String(acct.minimum_payment) : "",
    });
  };

  const chartData = plan?.debts.map((d) => ({
    name: d.account_name,
    "Balance": Number(d.starting_balance),
    "Total Interest": Number(d.total_interest),
  })) ?? [];

  const handleSuggestRates = async () => {
    setRateLoading(true);
    try {
      const result = await aiApi.suggestInterestRates();
      setRateSuggestions(result.suggestions);
      setRateNote(result.note);
      setDismissedRates(new Set());
      setAcceptedRateIds(new Set());
      if (result.suggestions.length === 0) {
        appToast.success(result.note || "All accounts already have rate data.");
      }
    } catch (err) {
      toastApiError(
        "Failed to get rate suggestions. Enable AI in Settings or check that Ollama is running.",
        err,
      );
    } finally {
      setRateLoading(false);
    }
  };

  const visibleRateSuggestions = rateSuggestions.filter((s) => !dismissedRates.has(s.account_id));
  const pendingSuggestions = visibleRateSuggestions.filter((s) => !acceptedRateIds.has(s.account_id));

  const acceptRateSuggestion = (s: InterestRateSuggestion) => {
    if (isAcceptingAll) return;
    updateMutation.mutate(
      { id: s.account_id, data: { interest_rate: s.suggested_apr, minimum_payment: s.suggested_min_payment } },
      {
        onSuccess: () => {
          setAcceptedRateIds((prev) => new Set([...prev, s.account_id]));
          appToast.success(`Applied rate for ${s.account_name}`);
        },
      },
    );
  };

  const handleAcceptAll = async () => {
    const toApply = visibleRateSuggestions.filter((s) => !acceptedRateIds.has(s.account_id));
    if (toApply.length === 0 || isAcceptingAll) return;
    setIsAcceptingAll(true);
    let succeeded = 0;
    let failed = 0;
    for (const s of toApply) {
      if (!mountedRef.current) break;
      try {
        await accountsApi.update(s.account_id, {
          interest_rate: s.suggested_apr,
          minimum_payment: s.suggested_min_payment,
        });
        if (mountedRef.current) {
          setAcceptedRateIds((prev) => new Set([...prev, s.account_id]));
        }
        succeeded++;
      } catch {
        failed++;
      }
    }
    if (mountedRef.current) {
      queryClient.invalidateQueries({ queryKey: ["debtAccounts"] });
      queryClient.invalidateQueries({ queryKey: ["payoffPlan"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      if (failed === 0) {
        appToast.success(`Applied ${succeeded} rate suggestion${succeeded !== 1 ? "s" : ""}`);
      } else {
        toastPlainError(`Applied ${succeeded} of ${succeeded + failed} (${failed} failed)`);
      }
    }
    if (mountedRef.current) {
      setIsAcceptingAll(false);
    }
  };

  const handleGetAiRecommendation = async () => {
    const requestId = ++aiRequestIdRef.current;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await aiApi.getDebtPlanSuggestion();
      if (requestId !== aiRequestIdRef.current) return;
      setAiSuggestion(result);
      setAiDismissed(false);
    } catch (err: unknown) {
      const status = (
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { status?: number } }).response?.status
      ) ?? undefined;
      if (status === 403) {
        setAiError("AI features are disabled. Enable AI Financial Advisor in Settings.");
      } else if (status === 503) {
        setAiError("AI backend unavailable. Start Ollama and ensure it is reachable from the API server, then try again.");
      } else {
        setAiError(getApiErrorMessage(err, "Failed to get AI recommendation. Please try again."));
      }
    } finally {
      if (requestId === aiRequestIdRef.current) {
        setAiLoading(false);
      }
    }
  };

  const applyRecommendation = () => {
    if (!aiSuggestion) return;
    hasUserInteracted.current = true;
    let appliedStrategy: DebtStrategy = "avalanche";
    const s = aiSuggestion.strategy.toLowerCase();
    if (s === "avalanche" || s === "snowball" || s === "hybrid") {
      appliedStrategy = s as DebtStrategy;
    }
    if (appliedStrategy === "hybrid") {
      const mapped = mapDebtPriorityNamesToIds(aiSuggestion.priority_order, debtAccounts);
      setPriorityAccountIds(mapped.length ? mapped : undefined);
    } else {
      setPriorityAccountIds(undefined);
    }
    setStrategy(appliedStrategy);
    const extra = aiSuggestion.monthly_extra > 0 ? aiSuggestion.monthly_extra : extraMonthly;
    setExtraMonthly(extra);
    persistPreferences(appliedStrategy, extra);
    appToast.success(
      `Applied ${STRATEGY_LABELS[appliedStrategy].label} strategy${aiSuggestion.monthly_extra > 0 ? ` + ${formatCurrency(aiSuggestion.monthly_extra)}/mo extra` : ""}`,
    );
  };

  return (
    <div className="space-y-4">
      {/* AI Recommendation Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI Recommendation
          </CardTitle>
          <CardDescription>
            Get a debt payoff strategy suggestion from AI based on your account list. {AI_COPY.educationalDisclaimer}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!aiSuggestion || aiDismissed ? (
            <div className="space-y-2">
              <Button
                onClick={handleGetAiRecommendation}
                disabled={aiLoading || debtAccounts.length === 0}
                size="sm"
              >
                {aiLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing your debt...</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Get AI Recommendation</>
                )}
              </Button>
              {aiError && (
                <p className="text-sm text-destructive">{aiError}</p>
              )}
              {debtAccounts.length === 0 && !isLoading && (
                <p className="text-xs text-muted-foreground">No debt accounts found.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize text-purple-700 border-purple-300">
                      {aiSuggestion.strategy}
                    </Badge>
                    {aiSuggestion.model_source && (
                      <span className="text-xs text-muted-foreground">{aiSuggestion.model_source}</span>
                    )}
                  </div>
                  <p className="text-sm">{aiSuggestion.rationale}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setAiDismissed(true)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {aiSuggestion.priority_order.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Recommended payoff order
                  </p>
                  <ol className="space-y-1">
                    {aiSuggestion.priority_order.map((name, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium shrink-0">
                          {i + 1}
                        </span>
                        {name}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {aiSuggestion.monthly_extra > 0 && (
                <p className="text-sm text-muted-foreground">
                  Suggested extra monthly payment: <span className="font-medium text-foreground">{formatCurrency(aiSuggestion.monthly_extra)}</span>
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={applyRecommendation}>
                  Apply Recommendation
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAiDismissed(true)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Debt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{formatCurrencyNegative(totalDebt)}</p>
          </CardContent>
        </Card>
        {plan && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Debt-Free In</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {plan.total_months < 12
                    ? `${plan.total_months} mo`
                    : `${Math.floor(plan.total_months / 12)}y ${plan.total_months % 12}m`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Interest</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-600">{formatCurrencyNegative(plan.total_interest)}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Amber warning: show when any account is missing rate data */}
      {!allHaveRates && debtAccounts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Interest rates and minimum payments are needed for payoff projections.
                SimpleFIN doesn&apos;t provide this data — you can enter it manually or let AI suggest typical rates.
              </p>
              <Button size="sm" variant="outline" onClick={handleSuggestRates} disabled={rateLoading} className="border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-200">
                {rateLoading ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Estimating...</> : <><Sparkles className="mr-2 h-3 w-3" />Suggest with AI</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rate suggestions list: independent of allHaveRates so it persists after first accept */}
      {visibleRateSuggestions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">AI Rate Suggestions</p>
            </div>
            <div className="flex gap-2">
              {pendingSuggestions.length > 1 && (
                <Button
                  size="sm"
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={handleAcceptAll}
                  disabled={isAcceptingAll}
                >
                  {isAcceptingAll ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Applying...</> : `Accept all (${pendingSuggestions.length})`}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleSuggestRates} disabled={rateLoading}>
                <RefreshCw className={cn("mr-1 h-3 w-3", rateLoading && "animate-spin")} /> Re-suggest
              </Button>
            </div>
          </div>
          {rateNote && <p className="text-xs text-amber-600 dark:text-amber-400 italic">{rateNote}</p>}
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Verify APR and minimum payments on your statement or issuer site—estimates can be wrong.
          </p>
          {visibleRateSuggestions.map((s) => {
            const isAccepted = acceptedRateIds.has(s.account_id);
            return (
              <div key={s.account_id} className={cn(
                "rounded-md bg-white dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 p-3 space-y-1",
                isAccepted && "opacity-70"
              )}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="font-medium text-sm">{s.account_name}</p>
                  <div className="flex gap-2">
                    {isAccepted ? (
                      <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium">
                        <Check className="h-3.5 w-3.5" /> Applied
                      </span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => acceptRateSuggestion(s)}
                          disabled={isAcceptingAll || updateMutation.isPending}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setDismissedRates((p) => new Set([...p, s.account_id]))}
                          disabled={isAcceptingAll}
                        >
                          Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  APR: <span className="font-medium">{(s.suggested_apr * 100).toFixed(2)}%</span>
                  {" · "}Min payment: <span className="font-medium">{formatCurrency(s.suggested_min_payment)}</span>
                </p>
                {s.reasoning && <p className="text-xs text-muted-foreground">{s.reasoning}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Debt list */}
      {isLoading ? (
        <SkeletonTable rows={3} columns={3} />
      ) : debtAccounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="text-muted-foreground">No debt accounts found. Nice work!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {debtAccounts.map((acct) => (
            <Card key={acct.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{acct.name}</p>
                      {acct.institution && <span className="text-xs text-muted-foreground">{acct.institution}</span>}
                      <Badge variant="outline" className="text-xs capitalize">{acct.account_type}</Badge>
                    </div>
                    <p className="text-xl font-bold text-red-600">{formatCurrencyNegative(acct.balance)}</p>
                    <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                      <span>APR: {acct.interest_rate != null ? `${(Number(acct.interest_rate) * 100).toFixed(2)}%` : <span className="text-amber-500">not set</span>}</span>
                      <span>Min: {acct.minimum_payment != null ? formatCurrency(Number(acct.minimum_payment)) : <span className="text-amber-500">not set</span>}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(acct)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Payoff plan settings */}
      {debtAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4" /> Payoff Strategy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={strategy} onValueChange={handleStrategyChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        <span className="font-medium">{v.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{STRATEGY_LABELS[strategy].description}</p>
              </div>
              <div className="space-y-2">
                <Label>Extra monthly payment</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input type="number" min="0" step="10" className="pl-7"
                    value={extraMonthly || ""}
                    onChange={(e) => handleExtraChange(parseFloat(e.target.value) || 0)}
                    placeholder="0" />
                </div>
                <p className="text-xs text-muted-foreground">Extra above minimums each month.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-debt results */}
      <div className={cn(planLoading && plan && "opacity-60 transition-opacity")}>
        {planLoading && <p className="text-muted-foreground text-sm">Calculating...</p>}
        {plan && plan.debts.map((debt) => (
          <Card key={debt.account_id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {debt.account_name}
                {debt.interest_rate == null && (
                  <Badge variant="outline" className="text-xs font-normal border-amber-400 text-amber-600">
                    <AlertCircle className="h-3 w-3 mr-1" /> No APR set
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {debt.payoff_date
                  ? `Paid off by ${debt.payoff_date} · ${debt.months_to_payoff} months`
                  : "Cannot pay off — minimum payment too low to cover interest"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {debt.interest_rate == null && (
                <p className="text-xs text-amber-600 mb-3">
                  Interest shown as $0 — add an APR to this account for accurate projections.
                </p>
              )}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><p className="text-muted-foreground">Balance</p><p className="font-semibold text-red-600">{formatCurrencyNegative(debt.starting_balance)}</p></div>
                <div><p className="text-muted-foreground">Interest</p><p className="font-semibold text-amber-600">{formatCurrencyNegative(debt.total_interest)}</p></div>
                <div><p className="text-muted-foreground">Total paid</p><p className="font-semibold">{formatCurrency(debt.total_paid)}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Balance vs. Interest</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => v < 1000 ? `$${v}` : `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: unknown) => {
                    const n = typeof v === "number" ? v : Number(v);
                    return formatCurrency(Number.isFinite(n) ? n : 0);
                  }}
                />
                <Legend />
                <Bar dataKey="Balance" fill="#ef4444" />
                <Bar dataKey="Total Interest" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Edit account dialog */}
      <Dialog open={!!editAccount} onOpenChange={(o) => { if (!o) setEditAccount(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Debt — {editAccount?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Interest Rate (APR %)</Label>
              <div className="relative">
                <Input type="number" step="0.01" min="0" max="100" className="pr-8"
                  value={editForm.interest_rate}
                  onChange={(e) => setEditForm((f) => ({ ...f, interest_rate: e.target.value }))}
                  placeholder="e.g. 24.99" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Minimum Monthly Payment</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input type="number" step="1" min="0" className="pl-7"
                  value={editForm.minimum_payment}
                  onChange={(e) => setEditForm((f) => ({ ...f, minimum_payment: e.target.value }))}
                  placeholder="e.g. 25" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditAccount(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!editAccount) return;
                  let rate: number | null = null;
                  let minPay: number | null = null;
                  if (editForm.interest_rate.trim() !== "") {
                    const r = parseFloat(editForm.interest_rate);
                    if (!Number.isFinite(r)) {
                      toastPlainError("Enter a valid interest rate.");
                      return;
                    }
                    rate = r / 100;
                  }
                  if (editForm.minimum_payment.trim() !== "") {
                    const m = parseFloat(editForm.minimum_payment);
                    if (!Number.isFinite(m)) {
                      toastPlainError("Enter a valid minimum payment.");
                      return;
                    }
                    minPay = m;
                  }
                  updateMutation.mutate(
                    { id: editAccount.id, data: { interest_rate: rate, minimum_payment: minPay } },
                    { onSuccess: () => { appToast.success("Account updated"); setEditAccount(null); } },
                  );
                }}
                disabled={updateMutation.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PLAN_HUB_INTRO_KEY = "budget_plan_hub_intro_seen";

function PlanHubIntro() {
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(PLAN_HUB_INTRO_KEY) === "1" : false,
  );

  if (dismissed) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Plan hub.</span>{" "}
        Use <strong>Debt</strong> for payoff strategies and <strong>Goals</strong> for savings targets—they share this page but stay separate tabs.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => {
          localStorage.setItem(PLAN_HUB_INTRO_KEY, "1");
          setDismissed(true);
        }}
      >
        Got it
      </Button>
    </div>
  );
}

function PlanContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get("tab");
  const activeTab: PlanTab = PLAN_TABS.includes((tab ?? "") as PlanTab) ? (tab as PlanTab) : "debt";

  useEffect(() => {
    if (tab && !PLAN_TABS.includes(tab as PlanTab)) {
      router.replace("/plan?tab=debt", { scroll: false });
    }
  }, [tab, router]);

  const handleTabChange = (value: string) => {
    router.replace(`/plan?tab=${value}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Plan"
        description="Plan debt payoff and savings goals in one place."
      />

      <PlanHubIntro />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2 max-w-xs">
          <TabsTrigger value="debt" className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Debt
          </TabsTrigger>
          <TabsTrigger value="goals" className="flex items-center gap-2">
            <Target className="h-4 w-4" /> Goals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="debt" className="mt-6">
          <DebtTab />
        </TabsContent>
        <TabsContent value="goals" className="mt-6">
          <GoalsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function PlanPage() {
  return (
    
      <Suspense
        fallback={
          <div className="space-y-6 p-4">
            <div className="h-10 w-64 animate-pulse rounded bg-muted" />
            <div className="h-40 rounded-lg bg-muted animate-pulse" />
          </div>
        }
      >
        <PlanContent />
      </Suspense>
    
  );
}
