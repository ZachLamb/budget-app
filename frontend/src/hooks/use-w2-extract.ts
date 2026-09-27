"use client";

import { useCallback } from "react";
import { W2_SYSTEM_PROMPT, w2Prompt } from "@/lib/llm/prompts/w2";
import {
  applyW2CrossChecks,
  verifyW2,
  type W2Extraction,
} from "@/lib/tax-docs/w2-extract";
import { useTaxDocExtract } from "./use-tax-doc-extract";

/** Read the numbered boxes off a W-2 PDF. */
export function useW2Extract() {
  const verify = useCallback(
    (raw: unknown, text: string): W2Extraction =>
      applyW2CrossChecks(verifyW2(raw, text)),
    [],
  );
  return useTaxDocExtract<W2Extraction>({
    feature: "w2_extract",
    system: W2_SYSTEM_PROMPT,
    buildPrompt: w2Prompt,
    verify,
  });
}
