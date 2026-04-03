"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { subscriptionsApi } from "@/lib/api/subscriptions";
import { getApiErrorMessage } from "@/lib/hooks";
import { ExternalLink, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

export function CancelGuideDialog({
  payeeName,
  open,
  onOpenChange,
}: {
  payeeName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const formId = useId();
  const [markedDone, setMarkedDone] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["cancel-guide", payeeName],
    queryFn: () => subscriptionsApi.cancelGuide(payeeName!),
    enabled: open && !!payeeName?.trim(),
  });

  const handleClose = (next: boolean) => {
    if (!next) setMarkedDone(false);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How to cancel</DialogTitle>
          <DialogDescription>
            {payeeName ? (
              <>Best-effort steps for <span className="font-medium text-foreground">{payeeName}</span>.</>
            ) : (
              "Select a payee first."
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Looking up guide…
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive py-2">
            {getApiErrorMessage(error, "Could not load cancel guide.")}
          </p>
        )}

        {data && !isLoading && (
          <div className="space-y-4 text-sm">
            {data.disclaimer && (
              <p className="text-xs text-muted-foreground border-l-2 border-amber-500/60 pl-2">
                {data.disclaimer}
              </p>
            )}

            {data.matched && data.display_name && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{data.display_name}</span>
                {data.verification === "official_docs" && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <ShieldCheck className="h-3 w-3" /> Official-style
                  </Badge>
                )}
                {data.verification === "maintainer_curated" && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <ShieldCheck className="h-3 w-3" /> Curated
                  </Badge>
                )}
                {data.verification === "community" && (
                  <Badge variant="outline" className="text-xs gap-1 text-amber-800 dark:text-amber-200">
                    <ShieldAlert className="h-3 w-3" /> Community
                  </Badge>
                )}
              </div>
            )}

            {!data.matched && (
              <p className="text-muted-foreground">
                We don&apos;t have a named guide for this merchant yet. Use the generic checklist below.
              </p>
            )}

            {data.verified_cancel_url && (
              <div>
                <Button variant="default" size="sm" className="gap-2" asChild>
                  <a
                    href={data.verified_cancel_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {data.link_is_verified ? "Open billing page" : "Open link (verify first)"}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                {!data.link_is_verified && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This URL isn&apos;t marked as fully verified—confirm it matches the real company before signing in.
                  </p>
                )}
              </div>
            )}

            {data.steps.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Steps</p>
                <ol className="list-decimal pl-4 space-y-1.5">
                  {data.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}

            {data.generic_steps.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Generic checklist</p>
                <ol className="list-decimal pl-4 space-y-1.5 text-muted-foreground">
                  {data.generic_steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}

            <div className="flex items-start gap-2 pt-2 border-t">
              <input
                id={formId}
                type="checkbox"
                checked={markedDone}
                onChange={(e) => setMarkedDone(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-primary"
              />
              <label htmlFor={formId} className="text-xs text-muted-foreground cursor-pointer leading-snug">
                I&apos;ve started or finished cancellation (reminder for yourself—we don&apos;t store this)
              </label>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
