"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OnDeviceAiSetupPanel } from "@/components/llm/on-device-ai-setup-panel";
import { AI_SETTINGS_PATH } from "@/lib/llm/ai-settings-link";
import {
  detectBrowser,
  unsupportedHeadline,
  PWA_NOT_REQUIRED,
} from "@/lib/llm/on-device-ai-guide";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";

export interface AiUnavailableProps {
  /**
   * Optional override for the headline. Defaults to an honest, jargon-free
   * line that doesn't mention tiers, providers, or model internals.
   */
  message?: string;
  className?: string;
  /** When provided, shows a button to launch the in-app setup wizard. */
  onStartSetup?: () => void;
}

/**
 * Shared empty-state when on-device AI can't run. Includes in-app fixes where
 * Chrome allows, plus a link to Settings.
 */
export function AiUnavailable({ message, className, onStartSetup }: AiUnavailableProps) {
  const browser = detectBrowser();
  const gate = useAiFeatureGate();
  const headline = message ?? unsupportedHeadline(browser);
  const startSetup = onStartSetup ?? (() => void gate.ensureLocalSetup("categorize_transaction"));

  return (
    <div
      role="status"
      tabIndex={0}
      className={cn(
        "flex flex-col items-stretch gap-4 rounded-lg border border-dashed p-6 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Cpu className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium">{headline}</p>
        <p className="max-w-[360px] text-xs text-muted-foreground">{PWA_NOT_REQUIRED}</p>
      </div>

      <OnDeviceAiSetupPanel
        compact
        localSetup={gate.localSetup}
        onActivate={() => gate.ensureLocalSetup("categorize_transaction")}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {browser.isDesktop && browser.isChromeFamily && (
          <Button type="button" size="sm" onClick={startSetup}>
            Open setup wizard
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" asChild>
          <Link href={AI_SETTINGS_PATH}>Open AI settings</Link>
        </Button>
      </div>
    </div>
  );
}
