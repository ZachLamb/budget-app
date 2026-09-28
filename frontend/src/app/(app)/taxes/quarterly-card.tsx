"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import type { QuarterlyPlan } from "@/lib/api/tax";

/**
 * Estimated payments, for income nobody withholds tax from.
 *
 * The withholding card answers "is enough being held back" and tells you
 * what to add per paycheck. That lever only exists if you have a
 * paycheck. Rental or self-employment income has no withholding at all,
 * and the way it gets paid is four estimated instalments on fixed dates.
 *
 * The thing worth knowing, and the reason a missed date is shown as
 * missed: withholding counts as paid evenly across the year whenever it
 * actually happened, while an estimated payment counts on the day it is
 * made. So raising withholding in December still fixes the whole year,
 * and sending a cheque in December does not fix April.
 */
export function QuarterlyCard({
  plan,
  year,
}: {
  plan: QuarterlyPlan;
  year: number;
}) {
  const missed = plan.installments.filter((i) => i.status === "paid_or_past");
  const next = plan.installments.find((i) => i.status === "due_next");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated payments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {plan.total === null ? (
          <p className="text-muted-foreground">{plan.reason}</p>
        ) : plan.installments.length === 0 ? (
          <p>{plan.reason}</p>
        ) : (
          <>
            <p>
              Beyond what your paycheques hold back, about{" "}
              <strong>{formatCurrency(plan.total)}</strong> is expected across{" "}
              {year}&apos;s four estimated payments.
            </p>

            <table className="w-full">
              <tbody>
                {plan.installments.map((i) => (
                  <tr key={i.number} className="border-b">
                    <td className="py-1">
                      Due {formatDate(i.due_date)}
                      {i.status === "due_next" && (
                        <span className="ml-2 rounded border px-1.5 py-0.5 text-xs">
                          next
                        </span>
                      )}
                      {i.status === "paid_or_past" && (
                        <span className="block text-xs text-muted-foreground">
                          this date has passed
                        </span>
                      )}
                    </td>
                    <td
                      className={
                        i.status === "paid_or_past"
                          ? "py-1 text-right font-mono text-muted-foreground"
                          : "py-1 text-right font-mono"
                      }
                    >
                      {formatCurrency(i.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {missed.length > 0 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                <p>
                  <strong>
                    {missed.length} of these dates {missed.length === 1 ? "has" : "have"}{" "}
                    already passed.
                  </strong>{" "}
                  If you haven&apos;t paid them, sending the money now does not
                  make them on time — a late instalment is what the
                  underpayment penalty is charged on.
                </p>
                <p className="mt-1">
                  Raising your withholding does still help, and more than you
                  would expect: tax withheld from a paycheque counts as paid
                  evenly across the whole year, whenever it was actually taken.
                  A bigger withholding for the rest of {year} can cover a
                  shortfall from April.
                </p>
              </div>
            )}

            {next && missed.length === 0 && (
              <p className="text-muted-foreground">
                The next one is {formatCurrency(next.amount)} on{" "}
                {formatDate(next.due_date)}.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Figures here assume your rental income is reported on Schedule E.
              A short-stay rental with substantial guest services is reported on
              Schedule C instead and adds self-employment tax, which this
              estimate does not include.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
