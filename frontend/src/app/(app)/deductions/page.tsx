"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonCard } from "@/components/skeleton-table";
import { deductionsApi } from "@/lib/api/deductions";
import { Label } from "@/components/ui/label";
import { DeductionsSummaryTable } from "./deductions-summary-table";

export default function DeductionsPage() {
  // On 1 January this page used to jump to the new year and take last
  // year's tracked spending with it -- exactly when you need it, because
  // that is the return you are about to file.
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const years = [thisYear, thisYear - 1, thisYear - 2];

  const summaryQuery = useQuery({
    queryKey: ["deductions-summary", year],
    queryFn: () => deductionsApi.summary(year),
    meta: inlineErrorQueryMeta,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deductions"
        description={
          <>
            Track tax-deductible spending and see what it is actually worth.
            Savings are worked out from published tax rates and the paystub
            you enter on the{" "}
            <Link href="/taxes" className="underline">
              Taxes
            </Link>{" "}
            page.
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Label htmlFor="deduction-year" className="text-sm">
          Tax year
        </Label>
        <select
          id="deduction-year"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <QueryState
        isLoading={summaryQuery.isLoading}
        isError={summaryQuery.isError}
        error={summaryQuery.error}
        onRetry={() => summaryQuery.refetch()}
        loadingFallback={<SkeletonCard />}
      >
        {summaryQuery.data ? (
          <div className="space-y-6">
            <DeductionsSummaryTable summary={summaryQuery.data} />
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
