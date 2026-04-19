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
import { ListChecks, Check, Circle, ChevronRight } from "lucide-react";
import Link from "next/link";

const STEPS = [
  { n: 0, label: "Observe", hint: "Scan spending for this pay window on the dashboard and Activity." },
  { n: 1, label: "Diagnose", hint: "Review recurring charges and subscription cancel help." },
  { n: 2, label: "Decide", hint: "Write 1–3 concrete intentions for before next pay." },
  { n: 3, label: "Done", hint: "You’ve walked the cycle for this window." },
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

  const reviewMutation = useMutation({
    mutationFn: settingsApi.updateCycleReview,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paySchedule"] });
      appToast.success("Review progress saved");
    },
    onError: (e) => toastApiError("Could not update review step", e),
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

  const step = Math.min(3, Math.max(0, paySchedule.review_step ?? 0));
  const active = commitments.filter((c: CycleCommitment) => c.status === "active");
  const hasSchedule = Boolean(paySchedule.pay_frequency);

  return (
    <Card id="cycle-review" className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          This pay cycle
        </CardTitle>
        <CardDescription>
          Observe → diagnose → decide. Resets when your pay window rolls forward.
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
            <div className="flex flex-wrap gap-2">
              {STEPS.slice(0, 3).map((s) => {
                const done = step > s.n;
                const current = step === s.n;
                return (
                  <div
                    key={s.n}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                      current && "border-primary bg-primary/5",
                      done && "opacity-70",
                    )}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium">{s.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">{STEPS[step]?.hint}</p>
            {isDemo ? (
              <p className="text-xs text-muted-foreground">
                Demo is read-only — sign up to track your own pay cycle and commitments.
              </p>
            ) : null}
            {step < 3 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1"
                  disabled={reviewMutation.isPending || isDemo}
                  title={isDemo ? "Demo is read-only" : undefined}
                  onClick={() => reviewMutation.mutate(Math.min(3, step + 1))}
                >
                  Complete “{STEPS[step]?.label}”
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                {step === 1 && (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link href="/recurring">Recurring &amp; suggestions</Link>
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-green-700 dark:text-green-400">Nice — cycle review complete for this window.</p>
            )}

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
