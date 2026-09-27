"use client";

import { useCallback, useRef, useState } from "react";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { userMessageFor } from "@/lib/llm/errors";
import type { FeatureId } from "@/lib/llm/features";
import { interpretPrepareFeatureResult } from "@/lib/llm/prepare-feature-result";
import { runStructuredJson, type RawStructured } from "@/lib/llm/run-structured";
import { useLlm } from "@/lib/llm/useLlm";
import { useDemoGuard, useIsClient } from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { settingsApi, type AiSettings } from "@/lib/api/settings";
import { extractPdfText, PdfTextError } from "@/lib/tax-docs/pdf-text";

export type ExtractStage = "preparing" | "reading" | "thinking" | null;

export interface TaxDocExtractConfig<T> {
  feature: FeatureId;
  system: string;
  buildPrompt: (documentText: string) => string;
  /**
   * Turn the model's raw JSON into something believable. Takes the
   * document text because that is the only thing that can tell a figure
   * that was read from one that was invented.
   */
  verify: (raw: unknown, documentText: string) => T;
}

/**
 * Read a tax document, entirely on this machine.
 *
 * The file is turned into text in the browser, the text goes to an
 * on-device model, and neither is uploaded or kept. What comes back is
 * checked against the document before the user ever sees it.
 */
export function useTaxDocExtract<T>(config: TaxDocExtractConfig<T>) {
  const { isDemo } = useDemoGuard();
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const isClient = useIsClient();
  // Where this will actually run decides what the card may promise about
  // the document: the local server is reached through the backend proxy,
  // so on that path the text does leave the browser.
  const { data: aiSettings } = useQuery({
    queryKey: ["aiSettings"],
    queryFn: settingsApi.getAiSettings,
    enabled: isClient,
  });
  const settings = aiSettings as AiSettings | undefined;
  const preferLocal = Boolean(settings?.prefer_local_server);
  const [stage, setStage] = useState<ExtractStage>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage(null);
  }, []);

  const { feature, system, buildPrompt, verify } = config;

  const extract = useCallback(
    async (file: File): Promise<T | null> => {
      setError(null);

      if (isDemo) {
        setError(
          "Reading a document is disabled in the demo — it would mean uploading a real tax document to a shared account.",
        );
        return null;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        if (preferLocal) {
          // The on-device gate would try to fetch a browser model that this
          // run is never going to use, and on a machine without one it waits
          // forever. The run still falls back to on-device if the server is
          // down, and that failure surfaces as an error rather than a hang.
          if (settings && !settings.ai_enabled) {
            setError("AI features are turned off. Enable them in Settings to continue.");
            return null;
          }
        } else {
          // Readiness first. On a machine with no on-device model this can sit
          // for minutes fetching one, and finding that out *after* picking a
          // file -- while the screen claims to still be reading it -- is the
          // worst order to do these two things in.
          setStage("preparing");
          const prepared = await gate.prepareFeature(feature);
          const interpretation = interpretPrepareFeatureResult(prepared);
          if (interpretation.action === "stop") {
            setError(interpretation.userMessage);
            return null;
          }
          if (ac.signal.aborted) return null;
        }

        setStage("reading");
        const { text } = await extractPdfText(file);
        if (ac.signal.aborted) return null;

        setStage("thinking");
        const { data } = await runStructuredJson<RawStructured>(
          feature,
          llm.getContext(feature),
          { system, prompt: buildPrompt(text), signal: ac.signal, preferLocal },
          false,
        );
        if (ac.signal.aborted) return null;

        return verify(data, text);
      } catch (e) {
        if (ac.signal.aborted) return null;
        // A PDF problem is the user's to fix and already says how.
        setError(e instanceof PdfTextError ? e.message : userMessageFor(e));
        return null;
      } finally {
        if (abortRef.current === ac) {
          setStage(null);
          abortRef.current = null;
        }
      }
    },
    [buildPrompt, feature, gate, isDemo, llm, preferLocal, settings, system, verify],
  );

  return {
    extract,
    cancel,
    stage,
    error,
    clearError: () => setError(null),
    /** True when the text will be proxied to the user's own model server. */
    usesLocalServer: preferLocal,
  };
}
