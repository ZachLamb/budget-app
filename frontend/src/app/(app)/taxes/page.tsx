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
} from "@/lib/api/tax";
import Link from "next/link";
import { useState } from "react";
import { ProjectionCard } from "./projection-card";
import { SetupChecklist, buildSteps } from "./setup-checklist";
import { WithholdingCard } from "./withholding-card";
import { QuarterlyCard } from "./quarterly-card";
import { NextDollarCard } from "./next-dollar-card";
import { FilingStatusWalkthrough } from "./filing-status-walkthrough";
import { StatePicker } from "./state-picker";
import { RentalTreatmentCard } from "./rental-treatment-card";
import { SelfEmploymentCard } from "./self-employment-card";
import { RentalActualsCard } from "./rental-actuals-card";
import { RentalParticipationCard } from "./rental-participation-card";
import { PaystubList } from "./paystub-list";
import { PaystubForm } from "./paystub-form";
import { PriorYearForm } from "./prior-year-form";
import { PriorYearUpload } from "./prior-year-upload";
import { PaystubUpload } from "./paystub-upload";
import { W2YearEndUpload } from "./w2-year-end-upload";
import { BacktestPanel } from "./backtest-panel";
import type { PaystubKey } from "@/lib/tax-docs/paystub-extract";
import type { PriorYearKey } from "@/lib/tax-docs/prior-year-extract";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

/** Name what was saved. A partial profile update can carry any of
 *  three unrelated answers, and a fixed message will be wrong for two
 *  of them. */
function profileSavedMessage(data: Partial<TaxProfile>): string {
  if (data.rental_treatment) return "Saved how your rental is run";
  if (data.rental_active_participation !== undefined)
    return "Saved your part in the rental";
  if (data.state) return "State saved";
  if (data.filing_status) return "Filing status saved";
  return "Saved";
}

export default function TaxesPage() {
  const year = new Date().getFullYear();
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState<Paystub | null>(null);
  // Remounting the form is how extracted figures reach it -- the same
  // trick the paystub form uses, and it avoids a setState-in-effect reset.
  const [extracted, setExtracted] = useState<{
    values: Partial<Record<PriorYearKey, number>>;
    nonce: number;
  } | null>(null);
  const [stubExtracted, setStubExtracted] = useState<{
    values: Partial<Record<PaystubKey, number>>;
    payDate: string | null;
    nonce: number;
  } | null>(null);

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
    // The walkthrough saves a status and its answers; the state picker
    // saves a state; the rental question saves a treatment. All are
    // partial updates to the same profile, so the message has to follow
    // what was actually sent -- "Filing status saved" after answering a
    // question about a rental reads as the app having misheard you.
    mutationFn: (data: Partial<TaxProfile>) => taxApi.saveProfile(data),
    onSuccess: (_res, data) => {
      queryClient.invalidateQueries({ queryKey: ["tax-profile"] });
      invalidateProjection();
      appToast.success(profileSavedMessage(data));
    },
    onError: (e) => toastApiError("Failed to save", e),
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

            {/* Shown whenever rental categories are marked, including
                when no projection could be produced: these are the
                user's own recorded figures, and they are real whether
                or not the rest of the tax inputs are there. */}
            {projectionQuery.data.rental && (
              <RentalActualsCard rental={projectionQuery.data.rental} />
            )}

            {/* Only when something actually owes it. Null here means
                "nothing does" -- no rental, a loss, or a Schedule E
                rental -- which is a different thing from a computed
                zero and should show no card at all. */}
            {projectionQuery.data.projection?.self_employment && (
              <SelfEmploymentCard
                se={projectionQuery.data.projection.self_employment}
              />
            )}

            {/* Only when there is something to pay, or a reason worth
                saying. A card of four zeroes for a pure W-2 filer is
                noise on a page that is already long. */}
            {projectionQuery.data.quarterly &&
              (projectionQuery.data.quarterly.total === null ||
                projectionQuery.data.quarterly.total > 0) && (
                <QuarterlyCard
                  plan={projectionQuery.data.quarterly}
                  year={year}
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

            <StatePicker
              profile={profileQuery.data}
              onSave={(data) => saveProfile.mutate(data)}
            />

            {/* Only when there is a loss for the answer to bite on, or
                one has already been given. Participation makes no
                difference to a profitable rental. */}
            {(projectionQuery.data.missing.includes("rental_active_participation") ||
              profileQuery.data.rental_active_participation !== null) && (
              <RentalParticipationCard
                profile={profileQuery.data}
                onSave={(data) => saveProfile.mutate(data)}
              />
            )}

            {/* Asked only once there is a rental to ask about: either the
                projection is waiting on the answer, or one has already
                been given and can be revisited. Nobody with a single W-2
                should meet this question at all. */}
            {(projectionQuery.data.missing.includes("rental_treatment") ||
              profileQuery.data.rental_treatment) && (
              <RentalTreatmentCard
                profile={profileQuery.data}
                onSave={(data) => saveProfile.mutate(data)}
                blocking={projectionQuery.data.missing.includes("rental_treatment")}
              />
            )}

            <PaystubList
              paystubs={paystubsQuery.data}
              onDelete={(id) => deletePaystub.mutate(id)}
              onEdit={(stub) => setCorrecting(stub)}
            />
            {/* Only offered for a new stub: correcting one is about the
                figures already saved, not a fresh document. */}
            {!correcting && (
              <PaystubUpload
                onUse={(values, payDate) =>
                  setStubExtracted((prev) => ({
                    values,
                    payDate,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }))
                }
              />
            )}
            {/* The same form, filled from a whole year instead of one
                check. A W-2 is a year-to-date snapshot taken on 31
                December, which is exactly what a paystub row holds. */}
            {!correcting && (
              <W2YearEndUpload
                onUse={(values, payDate) =>
                  setStubExtracted((prev) => ({
                    values,
                    payDate,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }))
                }
              />
            )}
            <PaystubForm
              key={
                correcting?.id ??
                (stubExtracted ? `stub-${stubExtracted.nonce}` : "new-paystub")
              }
              editing={correcting}
              prefill={correcting ? undefined : stubExtracted?.values}
              prefillDate={correcting ? undefined : stubExtracted?.payDate}
              onCancelEdit={() => setCorrecting(null)}
              onAdd={async (data) => {
                if (correcting) {
                  await updatePaystub.mutateAsync({ id: correcting.id, data });
                } else {
                  await addPaystub.mutateAsync(data);
                }
              }}
            />

            <PriorYearUpload
              onUse={(values) =>
                setExtracted((prev) => ({ values, nonce: (prev?.nonce ?? 0) + 1 }))
              }
            />

            <PriorYearForm
              key={extracted ? `extracted-${extracted.nonce}` : "prior-year"}
              prior={priorYearQuery.data ?? null}
              prefill={extracted?.values}
              onSave={async (data) => { await savePriorYear.mutateAsync(data); }}
            />

            {/* The fixture it writes describes a real filed return, so the
                panel is not in a production build at all. The endpoint
                refuses independently. */}
            {process.env.NODE_ENV !== "production" && <BacktestPanel />}

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
