"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { syncApi } from "@/lib/api/sync";
import { appToast } from "@/lib/app-toast";

/**
 * Auto-triggers the first sync right after a user connects bank account(s),
 * toasting success or a non-fatal "click Sync Now yourself" warning on failure.
 */
export function useTriggerFirstSync() {
  const queryClient = useQueryClient();

  return useCallback(
    (accountCount: number, ctaHint = 'Click "Sync Now" to import transactions.') => {
      const plural = accountCount !== 1 ? "s" : "";
      syncApi
        .trigger()
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
          appToast.success(`Connected ${accountCount} account${plural}. First sync started!`);
        })
        .catch(() => {
          appToast.warning(
            `Connected ${accountCount} account${plural}, but the first sync didn't start. ${ctaHint}`,
          );
        });
    },
    [queryClient],
  );
}
