"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonCard } from "@/components/skeleton-table";
import {
  taxApi,
  type Paystub,
  type PaystubInput,
  type PriorYearReturn,
  type TaxProfile,
  type FilingStatus,
} from "@/lib/api/tax";
import Link from "next/link";
import { useState } from "react";
import { ProjectionCard } from "./projection-card";
import { SetupChecklist, buildSteps } from "./setup-checklist";
import { WithholdingCard } from "./withholding-card";
import { NextDollarCard } from "./next-dollar-card";
import { FilingStatusWalkthrough } from "./filing-status-walkthrough";
import { PaystubList } from "./paystub-list";
import { PaystubForm } from "./paystub-form";
import { PriorYearForm } from "./prior-year-form";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

export default function TaxesPage() {
  const year = new Date().getFullYear();
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState<Paystub | null>(null);

  const projectionQuery = useQuery({
    queryKey: ["tax-projection", year],
    queryFn: () => taxApi.projection(year),
    meta: inlineErrorQueryMeta,
  });

  const profileQuery = useQuery({
    queryKey: ["tax-profile"],
    queryFn: () => taxApi.profile(),
    meta: inlineErrorQueryMeta,
  });

  const paystubsQuery = useQuery({
    queryKey: ["tax-paystubs"],
    queryFn: () => taxApi.paystubs(),
    meta: inlineErrorQueryMeta,
  });

  const priorYearQuery = useQuery({
    queryKey: ["tax-prior-year", year - 1],
    queryFn: () => taxApi.priorYear(year - 1),
    meta: inlineErrorQueryMeta,
  });

  const available = projectionQuery.data?.available ?? false;

  // `available` is folded into the query key (not just closed over) so
  // the query's identity changes — and it refetches — the moment the
  // projection flips from unavailable to available. Without that, the
  // very first resolution (before projectionQuery.data exists) caches
  // { wages: null, deferral: null } under a key that never changes
  // again, and NextDollarCard renders nothing forever. `enabled` also
  // stops a wasted null/null fetch from firing before the projection
  // has resolved at all.
  const impactQuery = useQuery({
    queryKey: ["tax-impact", year, available],
    queryFn: async () => {
      if (!available) return { wages: null, deferral: null };
      const [wages, deferral] = await Promise.all([
        taxApi.impact({ year, kind: "extra_wages", amount: 1000 }),
        taxApi.impact({ year, kind: "extra_pretax_401k", amount: 1000 }),
      ]);
      return { wages, deferral };
    },
    enabled: projectionQuery.isSuccess,
    meta: inlineErrorQueryMeta,
  });

  // The impact figures derive from the same paystub/profile inputs as
  // the projection, so anything that invalidates the projection must
  // also invalidate the impact query, or the two go stale independently.
  const invalidateProjection = () => {
    queryClient.invalidateQueries({ queryKey: ["tax-projection", year] });
    queryClient.invalidateQueries({ queryKey: ["tax-impact", year] });
  };

  const saveProfile = useMutation({
    mutationFn: (data: {
      filing_status: FilingStatus;
      walkthrough_answers: Record<string, unknown>;
    }) => taxApi.saveProfile(data as Partial<TaxProfile>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-profile"] });
      invalidateProjection();
      appToast.success("Filing status saved");
    },
    onError: (e) => toastApiError("Failed to save filing status", e),
  });

  const addPaystub = useMutation({
    mutationFn: (data: PaystubInput) => taxApi.addPaystub(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-paystubs"] });
      invalidateProjection();
      appToast.success("Paystub added");
    },
    onError: (e) => toastApiError("Failed to add paystub", e),
  });

  const updatePaystub = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PaystubInput }) =>
      taxApi.updatePaystub(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-paystubs"] });
      invalidateProjection();
      setCorrecting(null);
      appToast.success("Paystub updated");
    },
    onError: (e) => toastApiError("Failed to update paystub", e),
  });

  const deletePaystub = useMutation({
    mutationFn: (id: string) => taxApi.deletePaystub(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-paystubs"] });
      invalidateProjection();
      setCorrecting(null);
      appToast.success("Paystub deleted");
    },
    onError: (e) => toastApiError("Failed to delete paystub", e),
  });

  const savePriorYear = useMutation({
    mutationFn: (data: Partial<PriorYearReturn>) => taxApi.savePriorYear(year - 1, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-prior-year", year - 1] });
      invalidateProjection();
      appToast.success("Last year's return saved");
    },
    onError: (e) => toastApiError("Failed to save last year's return", e),
  });

  const isLoading =
    projectionQuery.isLoading ||
    profileQuery.isLoading ||
    paystubsQuery.isLoading ||
    priorYearQuery.isLoading;

  const isError =
    projectionQuery.isError ||
    profileQuery.isError ||
    paystubsQuery.isError ||
    priorYearQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Taxes"
        description="An estimate of what you'll owe or get back, built from your paystubs."
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={
          projectionQuery.error ?? profileQuery.error ?? paystubsQuery.error ?? priorYearQuery.error
        }
        onRetry={() => {
          projectionQuery.refetch();
          profileQuery.refetch();
          paystubsQuery.refetch();
          priorYearQuery.refetch();
        }}
        loadingFallback={<SkeletonCard />}
      >
        {projectionQuery.data && profileQuery.data && paystubsQuery.data ? (
          <div className="space-y-6">
            {/* An unsupported filing status is not a setup step -- it is a
                finished answer the engine cannot compute -- so it keeps the
                card rather than becoming a checklist item. */}
            {projectionQuery.data.missing.includes("unsupported_filing_status") ||
            projectionQuery.data.available ? (
              <ProjectionCard
                envelope={projectionQuery.data}
                filingStatus={profileQuery.data.filing_status}
              />
            ) : (
              <SetupChecklist
                year={year}
                steps={buildSteps({
                  missing: projectionQuery.data.missing,
                  hasPaystub: paystubsQuery.data.length > 0,
                  hasPriorYear: priorYearQuery.data !== null,
                })}
              />
            )}

            {projectionQuery.data.available &&
              projectionQuery.data.projection &&
              !projectionQuery.data.missing.includes("withholding") && (
              <WithholdingCard
                safeHarbor={projectionQuery.data.projection.safe_harbor}
                remainingPeriods={projectionQuery.data.remaining_pay_periods}
                partialYear={projectionQuery.data.missing.includes("pay_frequency")}
              />
            )}

            <NextDollarCard
              wages={impactQuery.data?.wages ?? null}
              deferral={impactQuery.data?.deferral ?? null}
            />

            <FilingStatusWalkthrough
              profile={profileQuery.data}
              onSave={(data) => saveProfile.mutate(data)}
              supportedStatuses={projectionQuery.data.supported_filing_statuses}
            />

            <PaystubList
              paystubs={paystubsQuery.data}
              onDelete={(id) => deletePaystub.mutate(id)}
              onEdit={(stub) => setCorrecting(stub)}
            />
            <PaystubForm
              key={correcting?.id ?? "new-paystub"}
              editing={correcting}
              onCancelEdit={() => setCorrecting(null)}
              onAdd={async (data) => {
                if (correcting) {
                  await updatePaystub.mutateAsync({ id: correcting.id, data });
                } else {
                  await addPaystub.mutateAsync(data);
                }
              }}
            />

            <PriorYearForm
              prior={priorYearQuery.data ?? null}
              onSave={async (data) => { await savePriorYear.mutateAsync(data); }}
            />

            <p className="text-sm text-muted-foreground">
              Spending you have marked tax deductible is valued against this
              estimate on the{" "}
              <Link href="/deductions" className="underline">
                Deductions
              </Link>{" "}
              page.
            </p>
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
