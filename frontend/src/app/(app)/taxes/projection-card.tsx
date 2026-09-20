"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectionEnvelope } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

const MISSING_LABELS: Record<string, string> = {
  filing_status: "How you file — answer the questions below.",
  paystub: "A recent paystub, including its year-to-date columns.",
  prior_year_return: "Last year's return (only needed for the withholding check).",
};

export function ProjectionCard({ envelope }: { envelope: ProjectionEnvelope }) {
  const [showWork, setShowWork] = useState(false);

  if (!envelope.available || !envelope.projection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your {envelope.year} taxes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Two things are needed before this can be worked out:
          </p>
          <ul className="list-disc pl-5">
            {envelope.missing
              .filter((m) => m !== "prior_year_return")
              .map((m) => (
                <li key={m}>{MISSING_LABELS[m] ?? m}</li>
              ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const p = envelope.projection;
  const owed = p.refund_or_amount_due < 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your {envelope.year} taxes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-lg">
          {owed ? "You're on track to owe " : "You're on track to get "}
          <strong>{formatCurrency(Math.abs(p.refund_or_amount_due))}</strong>
          {owed ? " when you file." : " back as a refund."}
        </p>

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
              <td className="py-1">Total tax for the year</td>
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
