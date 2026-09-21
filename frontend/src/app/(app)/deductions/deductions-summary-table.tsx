"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeductionsSummary } from "@/lib/api/deductions";
import { formatCurrency } from "@/lib/format";

export function DeductionsSummaryTable({ summary }: { summary: DeductionsSummary }) {
  if (summary.lines.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No deductible categories yet. Mark one as tax deductible on the{" "}
          <Link href="/categories" className="underline">
            Categories
          </Link>{" "}
          page and it shows up here.
        </CardContent>
      </Card>
    );
  }

  const businessSavings =
    summary.estimated_tax_savings === null
      ? null
      : summary.estimated_tax_savings - (summary.personal_itemized_value ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deductions Summary ({summary.year})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(["business_expense", "personal_itemized"] as const).map((kind) => {
          const lines = summary.lines.filter((l) => l.deduction_kind === kind);
          if (lines.length === 0) return null;
          return (
            <div key={kind}>
              <h3 className="text-sm font-medium">
                {kind === "business_expense" ? "Business expenses" : "Personal deductions"}
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.tax_line} className="border-b">
                      <td className="py-2">{line.tax_line}</td>
                      <td className="py-2 text-right">{formatCurrency(line.amount)}</td>
                    </tr>
                  ))}
                  {/* The explanation below quotes these subtotals, so they
                      have to be on screen to be checkable -- but a single
                      line is already its own total, so don't repeat it. */}
                  {lines.length > 1 && (
                  <tr className="border-b">
                    <td className="py-2 text-muted-foreground">
                      {kind === "business_expense" ? "Business total" : "Personal total"}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {formatCurrency(
                        kind === "business_expense"
                          ? summary.business_total
                          : summary.personal_itemized_total
                      )}
                    </td>
                  </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}

        <table className="w-full text-sm">
          <tbody>
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{formatCurrency(summary.total)}</td>
            </tr>
          </tbody>
        </table>

        {summary.estimated_tax_savings === null ? (
          <p className="text-sm text-muted-foreground">
            Set up your taxes to see what these deductions are actually worth.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              These deductions save you{" "}
              <strong>{formatCurrency(summary.estimated_tax_savings)}</strong> in
              tax this year.
            </p>

            {summary.personal_itemized_total > 0 &&
              summary.personal_itemized_value === 0 &&
              summary.standard_deduction !== null && (
                <p className="text-muted-foreground">
                  What you itemized here comes to{" "}
                  {formatCurrency(summary.personal_itemized_total)}, below your{" "}
                  {formatCurrency(summary.standard_deduction).replace(/\.00$/, "")} standard deduction,
                  so it&apos;s worth nothing this year. Items in this group only
                  start saving you money once they add up to more than that
                  amount. What you spend on your business is different — it
                  counts from the first dollar.
                </p>
              )}

            {summary.business_total > 0 && businessSavings === 0 && (
              <p className="text-muted-foreground">
                We currently value business expenses as if they create a
                rental loss. At your income, that loss isn&apos;t usable this
                year — it gets carried forward instead of reducing this
                year&apos;s tax, so it shows as $0 for now. Once we start
                tracking rental income, expenses that offset it will show
                their real value.
              </p>
            )}

            {summary.suggested_withholding_reduction_per_period !== null && (
              <p>
                You&apos;re on track for a refund, which means more is being held
                back than needed. Reducing it by about{" "}
                {formatCurrency(summary.suggested_withholding_reduction_per_period)}{" "}
                per paycheck would even it out.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              An estimate from published rates and the figures you entered, not
              tax advice. Which spending counts, and whether it is a business
              or personal deduction, is set per category on the{" "}
              <Link href="/categories" className="underline">
                Categories
              </Link>{" "}
              page.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
