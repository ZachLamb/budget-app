"use client";

import type { RentalActuals } from "@/lib/api/tax";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import Link from "next/link";
import { Info } from "lucide-react";

/**
 * Rental income and expenses, as recorded.
 *
 * Nothing here is annualised. A rental's income is lumpy — a summer
 * cabin earns most of its year in ten weeks — so scaling a part-year
 * figure up to twelve months would invent a number and, worse, state it
 * with the same confidence as a real one.
 *
 * The consequence is deliberate and has to be said out loud rather than
 * left for someone to discover: mid-year this makes the tax estimate
 * low, and it will rise as more comes in.
 */
export function RentalActualsCard({ rental }: { rental: RentalActuals }) {
  const isLoss = rental.net < 0;
  // Expenses marked, income not. Common, and it otherwise shows
  // "Rental income $0.00" beside real expenses -- which reads as a bug,
  // or as an accusation that the rental earned nothing.
  const incomeUnmarked = !rental.has_income_category;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <h2 className="text-base font-semibold">Rental (Schedule E)</h2>
          <p className="text-sm text-muted-foreground">
            From the transactions in your rental categories.
          </p>
        </div>

        {rental.through === null ? (
          // Marked but empty is a real state, and saying "$0 net" here
          // would read as a finished answer rather than an empty one.
          <p className="text-sm">
            You have marked rental categories, but nothing has been recorded in
            them this year yet.
          </p>
        ) : (
          <>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Rental income</dt>
                <dd className="tabular-nums">
                  {formatCurrency(rental.gross_rental_income)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Rental expenses</dt>
                <dd className="tabular-nums">
                  −{formatCurrency(rental.allowable_expenses)}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <dt>{isLoss ? "Net rental loss" : "Net rental income"}</dt>
                <dd className="tabular-nums">{formatCurrency(rental.net)}</dd>
              </div>
            </dl>

            {incomeUnmarked && (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
                <strong>No income category is marked as rent yet.</strong> The
                expenses below are counted, but nothing is offsetting them, so
                this reads as a loss it probably is not. Mark the category your
                rent lands in as rental income.
              </p>
            )}
            <p className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                This covers what you have recorded through{" "}
                <strong>{formatDate(rental.through)}</strong>. Your estimate
                will rise as more comes in — we do not guess at the rest of the
                year, because rental income rarely arrives evenly.
              </span>
            </p>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Income counts here when its category is marked as rental income, and
          expenses when they are marked deductible as a business expense. Both
          are set on the{" "}
          <Link href="/categories" className="underline">
            Categories
          </Link>{" "}
          page.
        </p>
      </CardContent>
    </Card>
  );
}
