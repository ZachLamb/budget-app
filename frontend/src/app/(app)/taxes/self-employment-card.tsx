"use client";

import type { SelfEmployment } from "@/lib/api/tax";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

/**
 * Shown only when something actually owes it.
 *
 * This is the tax that surprises people: an employer quietly pays half
 * your Social Security and Medicare and it never appears on a paystub.
 * Working for yourself, you pay both halves, and no withholding covers
 * it. Naming that is most of the card's job.
 */
export function SelfEmploymentCard({ se }: { se: SelfEmployment }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <h2 className="text-base font-semibold">Self-employment tax</h2>
          <p className="text-sm text-muted-foreground">
            Your rental is reported as a business, so its profit owes both
            halves of Social Security and Medicare — yours and the half an
            employer would normally pay. Nothing withholds this for you.
          </p>
        </div>

        <p className="text-3xl font-semibold tabular-nums">
          {formatCurrency(se.total)}
        </p>

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Net earnings (92.35% of profit)
            </dt>
            <dd className="tabular-nums">{formatCurrency(se.net_earnings)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Social Security (12.4%)</dt>
            <dd className="tabular-nums">{formatCurrency(se.social_security)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Medicare (2.9%)</dt>
            <dd className="tabular-nums">{formatCurrency(se.medicare)}</dd>
          </div>
          {se.additional_medicare > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Additional Medicare (0.9%)
              </dt>
              <dd className="tabular-nums">
                {formatCurrency(se.additional_medicare)}
              </dd>
            </div>
          )}
        </dl>

        <p className="rounded-md bg-muted/50 p-3 text-sm">{se.reason}</p>

        <p className="text-sm text-muted-foreground">
          Half of it — {formatCurrency(se.deductible_half)} — comes off your
          income before income tax is worked out, which is already reflected in
          the estimate above.
        </p>
      </CardContent>
    </Card>
  );
}
