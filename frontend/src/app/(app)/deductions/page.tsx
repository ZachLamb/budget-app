"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonCard } from "@/components/skeleton-table";
import { deductionsApi } from "@/lib/api/deductions";
import { taxSettingsApi, type TaxSettingsUpdate } from "@/lib/api/tax-settings";
import { DeductionsSummaryTable } from "./deductions-summary-table";
import { TaxSettingsCard } from "./tax-settings-card";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

export default function DeductionsPage() {
  const year = new Date().getFullYear();
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ["deductions-summary", year],
    queryFn: () => deductionsApi.summary(year),
    meta: inlineErrorQueryMeta,
  });

  const settingsQuery = useQuery({
    queryKey: ["tax-settings"],
    queryFn: () => taxSettingsApi.get(),
    meta: inlineErrorQueryMeta,
  });

  const saveSettings = useMutation({
    mutationFn: (data: TaxSettingsUpdate) => taxSettingsApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
      queryClient.invalidateQueries({ queryKey: ["deductions-summary", year] });
      appToast.success("Tax settings saved");
    },
    onError: (e) => toastApiError("Failed to save tax settings", e),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deductions"
        description="Track tax-deductible spending and estimate your savings."
      />

      <QueryState
        isLoading={summaryQuery.isLoading || settingsQuery.isLoading}
        isError={summaryQuery.isError || settingsQuery.isError}
        error={summaryQuery.error ?? settingsQuery.error}
        onRetry={() => {
          summaryQuery.refetch();
          settingsQuery.refetch();
        }}
        loadingFallback={<SkeletonCard />}
      >
        {summaryQuery.data && settingsQuery.data ? (
          <div className="space-y-6">
            <DeductionsSummaryTable summary={summaryQuery.data} />
            <TaxSettingsCard
              settings={settingsQuery.data}
              onSave={async (data) => {
                await saveSettings.mutateAsync(data);
              }}
            />
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
