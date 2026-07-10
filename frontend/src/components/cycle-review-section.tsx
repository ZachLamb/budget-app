"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingsApi } from "@/lib/api/settings";
import {
  cycleCommitmentsApi,
  type CycleCommitment,
  type CommitmentKind,
} from "@/lib/api/cycle-commitments";
import { useIsClient, useDemoGuard } from "@/lib/hooks";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";
import { cn } from "@/lib/utils";
import { ListChecks, Check, Circle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { deriveCycleSteps, getCycleVisit, CYCLE_TRACKED_PATHS } from "@/lib/cycle-progress";

type Step = {
  key: "observed" | "diagnosed" | "decided";
  label: string;
  hint: string;
  href?: string;
  linkLabel?: string;
};

const STEPS: Step[] = [
  {
    key: "observed",
    label: "Observe",
    hint: "Look over what you spent this pay window — completes once you open Transactions.",
    href: "/transactions",
    linkLabel: "Open Transactions",
  },
  {
    key: "diagnosed",
    label: "Diagnose",
    hint: "Review recurring charges and subscriptions — completes once you open Recurring.",
    href: "/recurring",
    linkLabel: "Review recurring",
  },
  {
    key: "decided",
    label: "Decide",
    hint: "Add a commitment below for before your next pay — or mark that nothing needs to change.",
  },
];

export function CycleReviewSection({ className }: { className?: string }) {
  const { isDemo } = useDemoGuard();
  const isClient = useIsClient();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CommitmentKind>("custom");

  const { data: paySchedule } = useQuery({
    queryKey: ["paySchedule"],
    queryFn: settingsApi.getPaySchedule,
    enabled: isClient,
  });

  const { data: commitments = [], isLoading } = useQuery({
    queryKey: ["cycle-commitments"],
    queryFn: cycleCommitmentsApi.list,
    enabled: isClient,
  });

  const ackMutation = useMutation({
    mutationFn: settingsApi.updateCycleReview,
    onSuccess: (data) => {
      queryClient.setQueryData(["paySchedule"], data);
    },
    onError: (e) => toastApiError("Could not update the checklist", e),
  });

  const createMut = useMutation({
    mutationFn: cycleCommitmentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cycle-commitments"] });
      setTitle("");
      appToast.success("Commitment added");
    },
    onError: (e) => toastApiError("Could not add commitment", e),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { status?: "active" | "done" | "dismissed" } }) =>
      cycleCommitmentsApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cycle-commitments"] }),
    onError: (e) => toastApiError("Update failed", e),
  });

  if (!isClient || !paySchedule) return null;

  const active = commitments.filter((c: CycleCommitment) => c.status === "active");
  const hasSchedule = Boolean(paySchedule.pay_frequency);

  const cycleStart = paySchedule.cycle.date_from;
  const decidedByAck = paySchedule.review?.decide_ack ?? false;
  const steps = deriveCycleSteps({
    cycleStart,
    serverObserved: paySchedule.review?.observed ?? false,
    serverDiagnosed: paySchedule.review?.diagnosed ?? false,
    observedAt: getCycleVisit(CYCLE_TRACKED_PATHS.observe),
    diagnosedAt: getCycleVisit(CYCLE_TRACKED_PATHS.diagnose),
    decidedThisCycle: commitments.length > 0 || decidedByAck,
  });

  return (
    <Card id="cycle-review" className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          This pay cycle
        </CardTitle>
        <CardDescription>
          Observe → diagnose → decide. Progress updates automatically as you review this window; it
          resets when your pay window rolls forward.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasSchedule ? (
          <p className="text-sm text-muted-foreground">
            {isDemo ? (
              <>Pay schedule and cycle checklist edits are disabled in the demo.</>
            ) : (
              <>
                <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
                  Set a pay schedule
                </Link>{" "}
                to anchor this checklist to your paychecks.
              </>
            )}
          </p>
        ) : (
          <>
            <ul className="space-y-2.5">
              {STEPS.map((s) => {
                const done = steps[s.key];
                return (
                  <li key={s.key} className="flex items-start gap-2">
                    {done ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium", done && "text-muted-foreground")}>
                        {s.label}
                        {done ? <span className="ml-1.5 text-xs font-normal text-green-600">done</span> : null}
                      </p>
                      {!done ? (
                        <p className="text-xs text-muted-foreground">{s.hint}</p>
                      ) : null}
                      {!done && s.href ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-1.5 h-7 gap-1 text-xs"
                          asChild
                        >
                          <Link href={s.href}>
                            {s.linkLabel}
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      ) : null}
                      {!done && s.key === "decided" ? (
                        <button
                          type="button"
                          className="mt-1.5 block text-xs text-primary underline-offset-4 hover:underline disabled:opacity-50"
                          disabled={ackMutation.isPending || isDemo}
                          title={isDemo ? "Demo is read-only" : undefined}
                          onClick={() => ackMutation.mutate({ decide_ack: true })}
                        >
                          Nothing to change this cycle
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {steps.allDone ? (
              <p className="text-sm text-green-700 dark:text-green-400">
                Nice — you’ve walked the full cycle for this window.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                These tick off on their own as you review — no buttons to click through.
              </p>
            )}

            {decidedByAck && commitments.length === 0 ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
                disabled={ackMutation.isPending || isDemo}
                title={isDemo ? "Demo is read-only" : undefined}
                onClick={() => ackMutation.mutate({ decide_ack: false })}
              >
                Undo “nothing to change”
              </button>
            ) : null}

            {isDemo ? (
              <p className="text-xs text-muted-foreground">
                Demo is read-only — sign up to track your own pay cycle and commitments.
              </p>
            ) : null}

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">Commitments (max 3 active)</p>
              {isLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : commitments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No items yet for this window.</p>
              ) : (
                <ul className="space-y-2">
                  {commitments.map((c: CycleCommitment) => (
                    <li
                      key={c.id}
                      className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.title}</p>
                        <div className="flex gap-1 mt-0.5">
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {c.kind}
                          </Badge>
                          <Badge variant={c.status === "active" ? "secondary" : "outline"} className="text-[10px]">
                            {c.status}
                          </Badge>
                        </div>
                      </div>
                      {c.status === "active" ? (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isDemo}
                            title={isDemo ? "Demo is read-only" : undefined}
                            onClick={() => patchMut.mutate({ id: c.id, data: { status: "done" } })}
                          >
                            Done
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={isDemo}
                            title={isDemo ? "Demo is read-only" : undefined}
                            onClick={() => patchMut.mutate({ id: c.id, data: { status: "dismissed" } })}
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {active.length < 3 && hasSchedule ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">New commitment</label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Cap dining at $200"
                      maxLength={300}
                      disabled={isDemo}
                    />
                  </div>
                  <div className="w-full sm:w-36 space-y-1">
                    <label className="text-xs text-muted-foreground">Type</label>
                    <Select value={kind} onValueChange={(v) => setKind(v as CommitmentKind)} disabled={isDemo}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">Custom</SelectItem>
                        <SelectItem value="cap">Cap</SelectItem>
                        <SelectItem value="cancel">Cancel</SelectItem>
                        <SelectItem value="save">Save</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    disabled={!title.trim() || createMut.isPending || isDemo}
                    title={isDemo ? "Demo is read-only" : undefined}
                    onClick={() => createMut.mutate({ title: title.trim(), kind })}
                  >
                    Add
                  </Button>
                </div>
              ) : hasSchedule && active.length >= 3 ? (
                <p className="text-xs text-muted-foreground">Three active commitments — mark one done or dismissed to add another.</p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
