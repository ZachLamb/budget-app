"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { accountsApi } from "@/lib/api/accounts";
import { transactionsApi } from "@/lib/api/transactions";
import { budgetApi } from "@/lib/api/budget";
import { settingsApi } from "@/lib/api/settings";
import { syncApi } from "@/lib/api/sync";
import { recurringApi } from "@/lib/api/recurring";
import { cycleCommitmentsApi } from "@/lib/api/cycle-commitments";
import { formatCurrency, getMonthString } from "@/lib/format";
import { useIsClient } from "@/lib/hooks";
import { toastApiError } from "@/lib/toast-error";
import { ArrowRight, RefreshCw } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { cn } from "@/lib/utils";

type ActionSpec = {
  title: string;
  detail: string;
  href?: string;
  primaryLabel: string;
  primaryVariant?: "sync" | "default";
  onPrimary?: () => void;
  primaryDisabled?: boolean;
};

export function NextBestAction({ className }: { className?: string }) {
  const isClient = useIsClient();
  const month = getMonthString(new Date());
  const queryClient = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { data: txnProbe } = useQuery({
    queryKey: ["transactions", "nba-probe"],
    queryFn: () => transactionsApi.list({ page: 1, page_size: 1 }),
    enabled: isClient,
  });
  const { data: uncat } = useQuery({
    queryKey: ["transactions", "uncategorized-count"],
    queryFn: () => transactionsApi.list({ uncategorized: true, page: 1, page_size: 1 }),
    enabled: isClient && accounts.length > 0,
  });
  const { data: budget } = useQuery({
    queryKey: ["budget", month, "nba"],
    queryFn: () => budgetApi.getMonth(month),
    enabled: isClient && accounts.length > 0,
  });
  const { data: simplefin } = useQuery({
    queryKey: ["simplefinStatus"],
    queryFn: settingsApi.getSimplefinStatus,
    enabled: isClient,
  });
  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    enabled: isClient,
  });
  const payReady = isClient && accounts.length > 0;
  const { data: paySchedule, isSuccess: payScheduleReady } = useQuery({
    queryKey: ["paySchedule"],
    queryFn: settingsApi.getPaySchedule,
    enabled: payReady,
  });
  const { data: recurringSuggestions = [] } = useQuery({
    queryKey: ["recurring-suggestions", 90],
    queryFn: () => recurringApi.suggestions(90),
    enabled: payReady,
    staleTime: 60_000,
  });
  const { data: cycleCommitments = [] } = useQuery({
    queryKey: ["cycle-commitments"],
    queryFn: cycleCommitmentsApi.list,
    enabled: payReady,
    staleTime: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: syncApi.trigger,
    onSuccess: () => {
      appToast.success("Sync started");
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    },
    onError: (e) => toastApiError("Failed to start sync", e),
  });

  const action = useMemo((): ActionSpec | null => {
    if (!isClient || accounts.length === 0) return null;

    const txnTotal = txnProbe?.total ?? 0;
    const uncatTotal = uncat?.total ?? 0;
    const income = budget?.total_income ?? 0;
    const assigned = budget?.total_assigned ?? 0;
    const ready = income - assigned;

    if (simplefin?.configured && syncStatus?.is_stale) {
      return {
        title: "Bank data may be out of date",
        detail: "Your last sync is older than your sync interval. Pull fresh transactions before you budget.",
        primaryVariant: "sync",
        primaryLabel: syncStatus?.syncing ? "Syncing…" : "Sync now",
        onPrimary: () => {
          if (!syncStatus?.syncing) syncMutation.mutate();
        },
        primaryDisabled: syncMutation.isPending || !!syncStatus?.syncing,
        href: "/settings",
      };
    }

    if (payScheduleReady && paySchedule && !paySchedule.pay_frequency) {
      return {
        title: "Set your pay schedule",
        detail:
          "Anchor spending to your paycheck cycle so the dashboard window and cycle checklist match how you’re paid.",
        href: "/settings",
        primaryLabel: "Open Settings",
      };
    }

    if (payReady && recurringSuggestions.length >= 3) {
      return {
        title: `${recurringSuggestions.length} recurring suggestions to review`,
        detail: "Confirm or dismiss detected patterns so your recurring list stays trustworthy.",
        href: "/recurring",
        primaryLabel: "Review recurring",
      };
    }

    if (uncatTotal > 0) {
      return {
        title: `${uncatTotal} uncategorized transaction${uncatTotal === 1 ? "" : "s"}`,
        detail: "Rules and reports only work when spending has categories.",
        href: "/transactions?uncategorized=1",
        primaryLabel: "Categorize",
      };
    }

    if (ready < -0.005) {
      return {
        title: "Budget is over-assigned",
        detail: `Ready to Assign is ${formatCurrency(ready)}. Move money from categories or adjust income so the math lines up.`,
        href: "/budget",
        primaryLabel: "Fix in Budget",
      };
    }

    if (ready > 10 && txnTotal > 0) {
      return {
        title: "Dollars waiting to be assigned",
        detail: `You have ${formatCurrency(ready)} Ready to Assign—give every dollar a job.`,
        href: "/budget",
        primaryLabel: "Assign in Budget",
      };
    }

    if (
      payScheduleReady &&
      paySchedule?.pay_frequency &&
      (paySchedule.review_step ?? 0) < 3
    ) {
      return {
        title: "Continue your pay-cycle review",
        detail: "Walk observe → diagnose → decide for this window, then add commitments if helpful.",
        href: "/#cycle-review",
        primaryLabel: "Go to checklist",
      };
    }

    const activeCommitments = cycleCommitments.filter((c) => c.status === "active");
    if (
      payScheduleReady &&
      paySchedule?.pay_frequency &&
      (paySchedule.review_step ?? 0) >= 3 &&
      activeCommitments.length > 0
    ) {
      return {
        title: `${activeCommitments.length} active pay-cycle commitment${activeCommitments.length === 1 ? "" : "s"}`,
        detail: "Check them off when you’ve acted, or dismiss if plans changed.",
        href: "/#cycle-review",
        primaryLabel: "View commitments",
      };
    }

    if (txnTotal === 0) {
      return {
        title: "Add this month’s activity",
        detail: "Import a CSV, add transactions manually, or sync a connected bank so the dashboard reflects reality.",
        href: "/transactions",
        primaryLabel: "Transactions",
      };
    }

    return null;
  }, [
    isClient,
    accounts.length,
    payReady,
    payScheduleReady,
    paySchedule,
    recurringSuggestions.length,
    cycleCommitments,
    txnProbe?.total,
    uncat?.total,
    budget?.total_income,
    budget?.total_assigned,
    simplefin?.configured,
    syncStatus?.is_stale,
    syncStatus?.syncing,
    syncMutation,
  ]);

  if (!isClient || !action) return null;

  return (
    <Card
      className={cn(
        "border-dashed border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20",
        className,
      )}
    >
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Next step
        </CardTitle>
        <CardDescription className="text-sm text-foreground font-medium pt-0.5">{action.title}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{action.detail}</p>
        <div className="flex flex-wrap gap-2">
          {action.onPrimary ? (
            <Button
              size="sm"
              onClick={action.onPrimary}
              disabled={action.primaryDisabled}
              className="gap-1"
            >
              {action.primaryVariant === "sync" ? (
                <RefreshCw
                  className={cn("h-3.5 w-3.5", action.primaryDisabled && "animate-spin")}
                />
              ) : null}
              {action.primaryLabel}
            </Button>
          ) : action.href ? (
            <Button size="sm" className="gap-1" asChild>
              <Link href={action.href}>
                {action.primaryLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
          {action.href && action.onPrimary ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={action.href}>Bank &amp; sync settings</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
