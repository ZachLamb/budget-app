"use client";

import { useEffect, useState } from "react";
import { Download, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { setDownloadModel } from "@/lib/llm/consent";
import { getCapability } from "@/lib/llm/capability";

interface Props {
  open: boolean;
  onClose: () => void;
  onGranted: () => void;
}

function formatGB(bytes: number | undefined): string {
  if (bytes === undefined || bytes <= 0) return "—";
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

export function DownloadConsentCard({ open, onClose, onGranted }: Props) {
  const [free, setFree] = useState<number | undefined>(undefined);
  const [size, setSize] = useState<"3b" | "1b" | "none">("none");

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    getCapability(true).then((c) => {
      if (!mounted) return;
      setFree(c.webgpu.storageQuotaBytes);
      setSize(c.webgpu.modelSize);
    });
    return () => {
      mounted = false;
    };
  }, [open]);

  const downloadSize = size === "3b" ? "1.8 GB" : size === "1b" ? "700 MB" : "—";
  const sizeNote = size === "1b" ? "Lite model — fits low-storage devices and iOS." : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5" /> Download on-device AI?
          </DialogTitle>
          <DialogDescription>
            On-device AI runs entirely in your browser. After the one-time download, it works offline and your data never leaves your device.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-md border p-3">
            <dt className="flex items-center gap-2 text-muted-foreground"><HardDrive className="size-4" /> Download size</dt>
            <dd className="font-medium">{downloadSize}</dd>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <dt className="flex items-center gap-2 text-muted-foreground"><HardDrive className="size-4" /> Free storage</dt>
            <dd className="font-medium">{formatGB(free)}</dd>
          </div>
        </dl>
        {sizeNote && <p className="text-xs text-muted-foreground">{sizeNote}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setDownloadModel("denied"); onClose(); }}>
            Not now
          </Button>
          <Button
            disabled={size === "none"}
            onClick={() => {
              setDownloadModel("granted");
              onGranted();
            }}
          >
            Download &amp; continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
