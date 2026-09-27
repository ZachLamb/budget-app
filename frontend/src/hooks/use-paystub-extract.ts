"use client";

import { useCallback } from "react";
import { PAYSTUB_SYSTEM_PROMPT, paystubPrompt } from "@/lib/llm/prompts/paystub";
import {
  applyPaystubCrossChecks,
  verifyPaystub,
  type PaystubExtraction,
} from "@/lib/tax-docs/paystub-extract";
import { useTaxDocExtract } from "./use-tax-doc-extract";

/** Read this period's and year-to-date figures off a paystub PDF. */
export function usePaystubExtract() {
  const verify = useCallback(
    (raw: unknown, text: string): PaystubExtraction =>
      applyPaystubCrossChecks(verifyPaystub(raw, text)),
    [],
  );
  return useTaxDocExtract<PaystubExtraction>({
    feature: "paystub_extract",
    system: PAYSTUB_SYSTEM_PROMPT,
    buildPrompt: paystubPrompt,
    verify,
  });
}
