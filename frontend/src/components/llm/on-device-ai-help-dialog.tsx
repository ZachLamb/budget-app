"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OnDeviceAiSetupPanel } from "@/components/llm/on-device-ai-setup-panel";
import { AI_SETTINGS_PATH } from "@/lib/llm/ai-settings-link";
import {
  detectBrowser,
  unsupportedHeadline,
  PWA_NOT_REQUIRED,
} from "@/lib/llm/on-device-ai-guide";

import type { LocalSetupSnapshot } from "@/hooks/local-ai-setup-types";

export interface OnDeviceAiHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail?: string;
  onStartSetup?: () => void;
  localSetup: LocalSetupSnapshot;
  onActivate: () => Promise<void>;
}

/**
 * Walkthrough when on-device AI cannot run yet — in-app activation where
 * possible, manual Chrome steps with copy buttons otherwise.
 */
export function OnDeviceAiHelpDialog({
  open,
  onOpenChange,
  detail,
  onStartSetup,
  localSetup,
  onActivate,
}: OnDeviceAiHelpDialogProps) {
  const browser = detectBrowser();
  const headline = unsupportedHeadline(browser);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="size-5" aria-hidden="true" />
            On-device AI setup
          </DialogTitle>
          <DialogDescription>{headline}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {detail && detail !== headline && (
            <p className="text-sm text-muted-foreground">{detail}</p>
          )}
          <p className="text-sm text-muted-foreground">{PWA_NOT_REQUIRED}</p>
          {open && (
            <OnDeviceAiSetupPanel compact localSetup={localSetup} onActivate={onActivate} />
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {onStartSetup && browser.isChromeFamily && browser.isDesktop && (
            <Button type="button" className="w-full" onClick={onStartSetup}>
              Open setup wizard
            </Button>
          )}
          <Button type="button" variant="outline" className="w-full" asChild>
            <Link href={AI_SETTINGS_PATH}>Open AI settings</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
