"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rulesApi, type RuleCandidate, type RulePreview } from "@/lib/api/rules";

/** How long to wait after the last keystroke before asking the server.
 *  Long enough that typing a payee name is one request, not fifteen. */
const DEBOUNCE_MS = 350;

/** Below this, a `contains` pattern matches most of the ledger and the
 *  count says nothing useful -- while costing a full scan per keystroke. */
const MIN_CHARS = 2;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export interface LivePreview {
  preview: RulePreview | undefined;
  isFetching: boolean;
  error: unknown;
  /** The literal to highlight, or "" when the pattern isn't a literal. */
  needle: string;
}

/**
 * Preview a rule while it is being typed.
 *
 * The question a rule editor cannot otherwise answer is "does this catch
 * what I meant, and nothing else". Asking the server as you type answers
 * it while you can still change your mind, rather than after saving the
 * rule and running it over everything.
 */
export function useRulePreview(
  candidate: RuleCandidate,
  { enabled = true }: { enabled?: boolean } = {},
): LivePreview {
  const value = candidate.match_value.trim();
  const settled = useDebounced(value, DEBOUNCE_MS);

  // `exact` on one character is a legitimate, cheap question; `contains`
  // on one character is not.
  const longEnough =
    candidate.match_type === "exact" ? settled.length > 0 : settled.length >= MIN_CHARS;

  const query = useQuery({
    queryKey: [
      "rule-preview-candidate",
      candidate.match_field,
      candidate.match_type,
      settled,
    ],
    queryFn: () =>
      rulesApi.previewCandidate({
        match_field: candidate.match_field,
        match_type: candidate.match_type,
        match_value: settled,
      }),
    enabled: enabled && longEnough,
    // A rule preview is a question about data that barely moves, and the
    // same pattern gets retyped while someone tunes it. Keep the answer.
    staleTime: 30_000,
    // A rejected pattern is a rejected pattern; retrying an invalid regex
    // three times just delays telling the user about it.
    retry: false,
  });

  return {
    preview: longEnough ? query.data : undefined,
    // Still typing counts as working, or the badge blinks out between
    // the keystroke and the debounce firing.
    isFetching: enabled && (query.isFetching || (longEnough && settled !== value)),
    error: query.error,
    needle: candidate.match_type === "regex" ? "" : settled,
  };
}
