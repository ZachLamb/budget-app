"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SafeHarbor } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

export function WithholdingCard({
  safeHarbor, remainingPeriods,
}: { safeHarbor: SafeHarbor; remainingPeriods: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Is enough being held back?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {safeHarbor.status === "unknown" && (
          <p className="text-muted-foreground">{safeHarbor.reason}</p>
        )}

        {safeHarbor.status === "met" && (
          <p>You&apos;re on track. No underpayment penalty is expected.</p>
        )}

        {safeHarbor.status === "not_met" && (
          <>
            <p>
              You&apos;re short by {formatCurrency(safeHarbor.shortfall ?? 0)} for
              the year.
            </p>
            {safeHarbor.per_period_to_close !== null ? (
              <p>
                Holding back{" "}
                <strong>{formatCurrency(safeHarbor.per_period_to_close)}</strong>{" "}
                more per paycheck for the remaining {remainingPeriods} would close it.
              </p>
            ) : (
              <p>There are no pay periods left this year to close the gap.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
