"use client";

import { AlertTriangle, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PIIScan, PIIFlag } from "@/lib/llm/pii-detect";

interface Props {
  scan: PIIScan;
  open: boolean;
  onCancel: () => void;
  onSendAnyway: () => void;
}

const FLAG_LABELS: Record<PIIFlag, string> = {
  ssn: "SSN",
  credit_card: "credit card number",
  email: "email address",
  phone: "phone number",
};

function joinHumanList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function PiiWarningDialog({ scan, open, onCancel, onSendAnyway }: Props) {
  // Categories only — never show matchedText to the user. The whole point of
  // this warning is that the matched substring is exactly what we don't want
  // them to send. Echoing it back would normalize the leak.
  const labels = scan.flags.map((f) => FLAG_LABELS[f]);
  const summary = joinHumanList(labels);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-600" />
            Looks like sensitive info
          </DialogTitle>
          <DialogDescription>
            Your message looks like it contains:{" "}
            <span className="font-medium text-foreground">{summary}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <Cloud className="size-4 mt-0.5 shrink-0" />
            <span>
              This request will be sent to our cloud AI server over an encrypted
              connection. Your prompt leaves this device.
            </span>
          </p>
          <p>
            We don&apos;t log or train on your prompts, but you may still want
            to remove sensitive details before sending.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" onClick={onSendAnyway}>
            Send anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
