"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";

/**
 * The first thing a new user met here was a card about a number that could
 * not be shown, above three forms and twenty-six inputs in a flat scroll.
 * Nothing said what order to do them in, how far along you were, or which
 * parts were optional. This says all three.
 */

export type SetupStep = {
  key: string;
  title: string;
  why: string;
  done: boolean;
  optional?: boolean;
  /** Where the step is done, when it isn't on this page. */
  href?: string;
  hrefLabel?: string;
};

export function buildSteps({
  missing,
  hasPaystub,
  hasPriorYear,
}: {
  missing: string[];
  hasPaystub: boolean;
  hasPriorYear: boolean;
}): SetupStep[] {
  return [
    {
      key: "filing_status",
      title: "How you file",
      why: "Two questions. It sets the tax brackets, so everything else depends on it.",
      done: !missing.includes("filing_status"),
    },
    {
      key: "paystub",
      title: "Your most recent paystub",
      why:
        "The date, this check's gross and gross year-to-date get you an " +
        "estimate. Add the tax-withheld boxes to see a refund or a bill.",
      done: hasPaystub && !missing.includes("paystub"),
    },
    {
      key: "pay_frequency",
      title: "How often you're paid",
      why: "Without it the rest of the year is left out of the estimate.",
      done: !missing.includes("pay_frequency"),
      href: "/settings#pay",
      hrefLabel: "Set it in Settings",
    },
    {
      key: "prior_year_return",
      title: "Last year's return",
      why: "Only needed to check whether enough tax is being held back to avoid a penalty.",
      done: hasPriorYear && !missing.includes("prior_year_return"),
      optional: true,
    },
  ];
}

export function SetupChecklist({ steps, year }: { steps: SetupStep[]; year: number }) {
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const allRequiredDone = doneCount === required.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {allRequiredDone ? `Your ${year} estimate` : `Set up your ${year} estimate`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {allRequiredDone
            ? "Everything needed is in. Anything left below is optional."
            : `${doneCount} of ${required.length} done. Nothing here is filed or sent anywhere — it only produces an estimate on this page.`}
        </p>

        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step.key} className="flex gap-3">
              <span
                aria-hidden="true"
                className={
                  step.done
                    ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"
                }
              >
                {step.done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span>
                <span className="font-medium">
                  {step.title}
                  {step.optional && (
                    <span className="font-normal text-muted-foreground"> — optional</span>
                  )}
                </span>
                <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                <p className="text-muted-foreground">{step.why}</p>
                {!step.done && step.href && (
                  <Link href={step.href} className="underline">
                    {step.hrefLabel ?? "Open"}
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
