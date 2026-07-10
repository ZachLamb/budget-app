"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api/settings";
import { useIsClient, useDemoGuard } from "@/lib/hooks";
import { recordCycleVisit, CYCLE_TRACKED_PATHS } from "@/lib/cycle-progress";

/**
 * Records visits to the pages that feed the "This pay cycle" checklist
 * (Observe → Transactions, Diagnose → Recurring). Renders nothing.
 *
 * Visits are stamped in localStorage for instant same-device feedback, and
 * pushed to the server (once per cycle) so progress survives across devices.
 * Demo mode stays local-only — the demo household is shared.
 */
export function CycleVisitTracker() {
  const pathname = usePathname();
  const isClient = useIsClient();
  const { isDemo } = useDemoGuard();
  const queryClient = useQueryClient();

  const { data: paySchedule } = useQuery({
    queryKey: ["paySchedule"],
    queryFn: settingsApi.getPaySchedule,
    enabled: isClient,
  });

  const signalMutation = useMutation({
    mutationFn: settingsApi.updateCycleReview,
    onSuccess: (data) => {
      queryClient.setQueryData(["paySchedule"], data);
    },
    // Silent: the local visit stamp already updated the UI; the server
    // signal is a durability bonus and will retry on the next visit.
    onError: () => {},
  });

  const serverObserved = paySchedule?.review?.observed ?? false;
  const serverDiagnosed = paySchedule?.review?.diagnosed ?? false;
  const scheduleLoaded = Boolean(paySchedule);
  const { mutate: sendSignal, isPending } = signalMutation;

  useEffect(() => {
    if (!pathname) return;
    const isObserve = pathname === CYCLE_TRACKED_PATHS.observe;
    const isDiagnose = pathname === CYCLE_TRACKED_PATHS.diagnose;
    if (!isObserve && !isDiagnose) return;

    recordCycleVisit(pathname);

    if (isDemo || !scheduleLoaded || isPending) return;
    if (isObserve && !serverObserved) sendSignal({ observed: true });
    if (isDiagnose && !serverDiagnosed) sendSignal({ diagnosed: true });
  }, [pathname, isDemo, scheduleLoaded, serverObserved, serverDiagnosed, isPending, sendSignal]);

  return null;
}
