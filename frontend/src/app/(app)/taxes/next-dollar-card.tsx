"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImpactResult } from "@/lib/api/tax";
import { formatCurrency } from "@/lib/format";

/**
 * Leads with DOLLARS. Any percentage is labeled with the amount it is
 * blended over, because a rate from an arbitrary step is step-dependent
 * near a bracket edge.
 */
export function NextDollarCard({
  wages, deferral,
}: { wages: ImpactResult | null; deferral: ImpactResult | null }) {
  if (!wages && !deferral) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the next $1,000 does</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {wages && (
          <p>
            Earning $1,000 more costs you{" "}
            <strong>{formatCurrency(wages.amount_of_tax)}</strong> in tax — about{" "}
            {wages.blended_rate_percent.toFixed(1)}% across this $1,000.
          </p>
        )}
        {deferral && (
          <p>
            Putting $1,000 into your 401(k) saves you{" "}
            <strong>{formatCurrency(Math.abs(deferral.amount_of_tax))}</strong> —
            about {Math.abs(deferral.blended_rate_percent).toFixed(1)}% over the same
            $1,000. It&apos;s less than the rate above because money set aside for
            retirement still has Social Security and Medicare taken out.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
