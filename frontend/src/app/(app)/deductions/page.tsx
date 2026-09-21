"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonCard } from "@/components/skeleton-table";
import { deductionsApi } from "@/lib/api/deductions";
import { DeductionsSummaryTable } from "./deductions-summary-table";

export default function DeductionsPage() {
  const year = new Date().getFullYear();

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
