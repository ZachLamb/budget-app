"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { llmApi } from "@/lib/api/llm";
import { toastApiError } from "@/lib/toast-error";

interface Props {
  open: boolean;
  feature: string;
  featureLabel: string;
  onClose: () => void;
  onGranted: () => void;
}

export function CloudConsentDialog({ open, feature, featureLabel, onClose, onGranted }: Props) {
  const qc = useQueryClient();
  const grant = useMutation({
    mutationFn: () => llmApi.grantCloudConsent(feature),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llmCloudConsent"] });
      onGranted();
    },
    onError: (e) => {
      toastApiError("Couldn't save consent", e);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="size-5" /> Send to cloud AI?
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{featureLabel}</span> uses our private cloud AI model.
            Your prompt is sent over an encrypted connection to a server we run.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2"><ShieldCheck className="size-4 mt-0.5 shrink-0" /> We don&apos;t log your requests.</li>
          <li className="flex items-start gap-2"><ShieldCheck className="size-4 mt-0.5 shrink-0" /> We don&apos;t train on your data.</li>
          <li className="flex items-start gap-2"><ShieldCheck className="size-4 mt-0.5 shrink-0" /> Self-hosted model — no third-party AI providers.</li>
          <li className="flex items-start gap-2"><ShieldCheck className="size-4 mt-0.5 shrink-0" /> Revoke any time in Settings → AI.</li>
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => grant.mutate()} disabled={grant.isPending}>
            {grant.isPending ? "Saving…" : "Allow for this feature"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
