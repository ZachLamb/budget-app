"use client";

import { useCallback } from "react";
import {
  PRIOR_YEAR_SYSTEM_PROMPT,
  priorYearPrompt,
} from "@/lib/llm/prompts/prior-year";
import {
  applyCrossChecks,
  verifyExtraction,
  type PriorYearExtraction,
} from "@/lib/tax-docs/prior-year-extract";
import { useTaxDocExtract } from "./use-tax-doc-extract";

export type { ExtractStage } from "./use-tax-doc-extract";

/** Read last year's figures off a Form 1040 PDF. */
export function usePriorYearExtract() {
  const verify = useCallback(
    (raw: unknown, text: string): PriorYearExtraction =>
      applyCrossChecks(verifyExtraction(raw, text)),
    [],
  );
  return useTaxDocExtract<PriorYearExtraction>({
    feature: "prior_year_extract",
    system: PRIOR_YEAR_SYSTEM_PROMPT,
    buildPrompt: priorYearPrompt,
    verify,
  });
}
