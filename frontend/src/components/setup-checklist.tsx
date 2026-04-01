"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { accountsApi } from "@/lib/api/accounts";
import { transactionsApi } from "@/lib/api/transactions";
import { budgetApi } from "@/lib/api/budget";
import { settingsApi } from "@/lib/api/settings";
import { getMonthString } from "@/lib/format";
import { useIsClient } from "@/lib/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildSetupSteps, isCoreSetupComplete } from "@/lib/ux-plan-logic";

const DISMISS_KEY = "budget_setup_checklist_dismissed";
/** ISO timestamp set once when core setup steps (non-optional) all complete — for activation analytics. */
const FIRST_OUTCOME_KEY = "budget_first_outcome_at";

export function SetupChecklist({
  className,
  variant = "dashboard",
}: {
  className?: string;
  variant?: "dashboard" | "settings";
}) {
  const isClient = useIsClient();
  const month = getMonthString(new Date());
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(DISMISS_KEY) === "1" : false,
  );
  const isSettings = variant === "settings";

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountsApi.list,
    enabled: isClient,
  });
  const { data: txnProbe } = useQuery({
    queryKey: ["transactions", "setup-probe"],
    queryFn: () => transactionsApi.list({ page: 1, page_size: 1 }),
    enabled: isClient,
  });
  const { data: budget } = useQuery({
    queryKey: ["budget", month, "setup"],
    queryFn: () => budgetApi.getMonth(month),
    enabled: isClient,
  });
  const { data: simplefin } = useQuery({
    queryKey: ["simplefinStatus"],
    queryFn: settingsApi.getSimplefinStatus,
    enabled: isClient,
  });

  const steps = useMemo(
    () =>
      buildSetupSteps({
        accountCount: accounts.length,
        transactionTotal: txnProbe?.total ?? 0,
        budgetAssigned: budget?.total_assigned ?? 0,
        simplefinConfigured: !!simplefin?.configured,
      }),
    [accounts.length, txnProbe?.total, budget?.total_assigned, simplefin?.configured],
  );

  const coreDone = isCoreSetupComplete(steps);
  const coreDoneRef = useRef(false);

  useEffect(() => {
    if (!isClient || !coreDone || coreDoneRef.current) return;
    coreDoneRef.current = true;
    if (typeof localStorage !== "undefined" && !localStorage.getItem(FIRST_OUTCOME_KEY)) {
      localStorage.setItem(FIRST_OUTCOME_KEY, new Date().toISOString());
    }
  }, [isClient, coreDone]);

  if (!isClient) return null;
  if (!isSettings && (dismissed || coreDone)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <Card className={cn("border-primary/20 bg-primary/5", className)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">
          {isSettings ? "Getting started" : "Finish setup"}
        </CardTitle>
        {!isSettings && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mt-1 -mr-2 text-muted-foreground"
            aria-label="Dismiss setup checklist"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground text-xs pb-1">
          {isSettings
            ? "Track progress on the core steps below. Optional items help automate imports."
            : "You can reopen this anytime from Settings → Getting started."}
        </p>
        {isSettings && coreDone && (
          <p className="text-xs font-medium text-green-700 dark:text-green-400 pb-1">
            Core setup complete — nice work.
          </p>
        )}
        <ul className="space-y-2">
          {steps.map((s) => (
            <li key={s.id}>
              <Link
                href={s.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-background/80",
                  s.done && "text-muted-foreground",
                )}
              >
                {s.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span>
                  {s.label}
                  {s.optional && (
                    <span className="text-muted-foreground text-xs"> — optional</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
