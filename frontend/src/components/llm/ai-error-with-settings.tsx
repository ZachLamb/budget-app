"use client";

import Link from "next/link";
import { AI_SETTINGS_PATH, isAiAvailabilityMessage } from "@/lib/llm/ai-settings-link";
import { cn } from "@/lib/utils";

export interface AiErrorWithSettingsProps {
  message: string;
  className?: string;
}

/** Inline AI error with a link to Settings → AI. */
export function AiErrorWithSettings({ message, className }: AiErrorWithSettingsProps) {
  return (
    <p className={cn("text-sm text-destructive", className)}>
      {message}{" "}
      <Link href={AI_SETTINGS_PATH} className="font-medium underline underline-offset-2">
        Fix in AI settings
      </Link>
    </p>
  );
}

/** Shows settings link only when the message looks like an on-device AI issue. */
export function MaybeAiErrorWithSettings({ message, className }: AiErrorWithSettingsProps) {
  if (isAiAvailabilityMessage(message)) {
    return <AiErrorWithSettings message={message} className={className} />;
  }
  return <p className={cn("text-sm text-destructive", className)}>{message}</p>;
}
