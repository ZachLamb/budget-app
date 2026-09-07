"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeductionsSummary } from "@/lib/api/deductions";
import { formatCurrency } from "@/lib/format";

export function DeductionsSummaryTable({ summary }: { summary: DeductionsSummary }) {
  if (summary.lines.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No deductible categories yet. Mark a category as tax deductible from the Categories page to see it here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deductions Summary ({summary.year})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <table className="w-full text-sm">
          <tbody>
            {summary.lines.map((line) => (
              <tr key={line.tax_line} className="border-b">
                <td className="py-2">{line.tax_line}</td>
                <td className="py-2 text-right">{formatCurrency(line.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{formatCurrency(summary.total)}</td>
            </tr>
          </tbody>
        </table>

        {summary.estimated_tax_savings === null ? (
          <p className="text-sm text-muted-foreground">
            Add your tax rate below to see an estimated tax savings.
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <p>Estimated tax savings: {formatCurrency(summary.estimated_tax_savings)}</p>
            {summary.suggested_withholding_reduction_per_period !== null && (
              <p>
                You could consider reducing withholding by ~{formatCurrency(summary.suggested_withholding_reduction_per_period)}/paycheck
                for the rest of the year.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              This is an estimate based on the rate you entered, not tax advice.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
