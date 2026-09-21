"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilingStatus, ProjectionEnvelope } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

const MISSING_LABELS: Record<string, string> = {
  filing_status: "How you file — answer the questions below.",
  paystub: "A recent paystub, including its year-to-date columns.",
  prior_year_return: "Last year's return (only needed for the withholding check).",
  pay_frequency: "How often you are paid — set it in Settings.",
};

const STATUS_LABELS: Record<FilingStatus, string> = {
  single: "single",
  married_joint: "married, filing together",
  married_separate: "married, filing separately",
  head_of_household: "head of household",
  qualifying_surviving_spouse: "qualifying surviving spouse",
};

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four"];

function needed(count: number): string {
  const word = COUNT_WORDS[count] ?? String(count);
  return `${word} thing${count === 1 ? " is" : "s are"} needed before this can be worked out:`;
}

export function ProjectionCard({
  envelope,
  filingStatus = null,
}: {
  envelope: ProjectionEnvelope;
  filingStatus?: FilingStatus | null;
}) {
  const [showWork, setShowWork] = useState(false);

  // An unsupported filing status is not a blank to fill in, so it does not
  // belong in the "things are needed" list. It also must never surface the
  // engine's own message -- "add its sourced rate table instead" is aimed
  // at whoever maintains this app, not at the person reading it.
  if (envelope.missing.includes("unsupported_filing_status")) {
    const supported = envelope.supported_filing_statuses
      .map((s) => STATUS_LABELS[s] ?? s)
      .join(" or ");
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your {envelope.year} taxes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            You file as{" "}
            <strong>
              {filingStatus ? (STATUS_LABELS[filingStatus] ?? filingStatus) : "a status"}
            </strong>
            , and this page can only work out {supported || "single"} filers so far.
          </p>
          <p className="text-muted-foreground">
            The rates differ by thousands of dollars between statuses, so
            showing an estimate from the wrong ones would be worse than
            showing none. Your paystubs and answers below are saved and will
            be used as soon as your status is supported.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!envelope.available || !envelope.projection) {
    const blocking = envelope.missing.filter((m) => m !== "prior_year_return");
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your {envelope.year} taxes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{needed(blocking.length)}</p>
          <ul className="list-disc pl-5">
            {blocking.map((m) => (
              <li key={m}>{MISSING_LABELS[m] ?? m}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const p = envelope.projection;
  const owed = p.refund_or_amount_due < 0;
  // No usable pay frequency means the remainder of the year was projected as
  // no pay at all. The figures below are still real -- they are just a
  // year-to-date picture -- so show them, and say so rather than letting a
  // September paystub read as a full year.
  const unprojectedRemainder = envelope.missing.includes("pay_frequency");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your {envelope.year} taxes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {unprojectedRemainder ? (
          <>
            <p className="text-lg">
              So far this year,{" "}
              {owed ? (
                <>
                  you owe{" "}
                  <strong>{formatCurrency(Math.abs(p.refund_or_amount_due))}</strong>{" "}
                  more than has been held back.
                </>
              ) : (
                <>
                  <strong>{formatCurrency(p.refund_or_amount_due)}</strong> more has
                  been held back than you owe.
                </>
              )}
            </p>
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              That covers your pay so far, not the rest of the year — we don&apos;t
              know how often you&apos;re paid, so nothing has been added for the
              paychecks still to come. Set your{" "}
              <Link href="/settings" className="underline">
                pay schedule
              </Link>{" "}
              for a full-year estimate.
            </p>
          </>
        ) : (
          <p className="text-lg">
            {owed ? "You're on track to owe " : "You're on track to get "}
            <strong>{formatCurrency(Math.abs(p.refund_or_amount_due))}</strong>
            {owed ? " when you file." : " back as a refund."}
          </p>
        )}

        <table className="w-full">
          <tbody>
            <tr className="border-b">
              <td className="py-1">What you earn</td>
              <td className="py-1 text-right">{formatCurrency(p.agi)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">
                {p.deduction_kind === "standard"
                  ? "Standard deduction (the flat amount everyone can subtract)"
                  : "Your itemized deductions"}
              </td>
              <td className="py-1 text-right">−{formatCurrency(p.deduction_taken)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Income you&apos;re taxed on</td>
              <td className="py-1 text-right">{formatCurrency(p.taxable_income)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Federal income tax</td>
              <td className="py-1 text-right">{formatCurrency(p.federal_income_tax)}</td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Social Security and Medicare</td>
              <td className="py-1 text-right">
                {formatCurrency(p.social_security_tax + p.medicare_tax + p.additional_medicare_tax)}
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-1">Colorado income tax</td>
              <td className="py-1 text-right">{formatCurrency(p.state_tax)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-1">
                {unprojectedRemainder ? "Total tax so far" : "Total tax for the year"}
              </td>
              <td className="py-1 text-right">{formatCurrency(p.total_liability)}</td>
            </tr>
            <tr>
              <td className="py-1">Held back from your paychecks</td>
              <td className="py-1 text-right">{formatCurrency(p.total_withheld_projected)}</td>
            </tr>
          </tbody>
        </table>

        <Button variant="ghost" size="sm" onClick={() => setShowWork((v) => !v)}>
          {showWork ? "Hide the work" : "Show the work"}
        </Button>

        {showWork && (
          <ol className="space-y-2 border-t pt-3">
            {p.explain.map((step, i) => (
              <li key={`${step.label}-${i}`}>
                <div className="flex justify-between">
                  <span className="font-medium">{step.label}</span>
                  <span>{formatCurrency(step.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </li>
            ))}
          </ol>
        )}

        <p className="text-xs text-muted-foreground">
          This is an estimate from published rates and the figures you entered.
          It is not tax advice or a filing tool.
        </p>
      </CardContent>
    </Card>
  );
}
