/**
 * Capability-detected wrappers for Chrome's specialized on-device AI APIs.
 *
 * Every helper degrades to a Prompt-API (Nano) generate when its specialized
 * API or origin-trial token is absent, so a missing token never breaks a
 * feature. None of these run in Web Workers (web-llm cannot use them).
 */

import type { GenerateOptions, LLMProvider } from "./types";

type AvailabilityApi = { availability: () => Promise<string>; create: (opts?: unknown) => Promise<unknown> };

function api(name: string): AvailabilityApi | null {
  const a = (globalThis as unknown as Record<string, AvailabilityApi | undefined>)[name];
  return a && typeof a.availability === "function" ? a : null;
}

async function isReady(name: string): Promise<boolean> {
  const a = api(name);
  if (!a) return false;
  try {
    return (await a.availability()) === "available";
  } catch {
    return false;
  }
}

async function collect(provider: LLMProvider, prompt: string, opts: GenerateOptions): Promise<string> {
  let out = "";
  for await (const chunk of provider.generate(prompt, opts)) out += chunk;
  return out.trim();
}

/** Condense text. Summarizer API (stable) or Prompt-API fallback. */
export async function summarize(
  fallback: LLMProvider,
  text: string,
  opts: GenerateOptions = {},
): Promise<string> {
  if (await isReady("Summarizer")) {
    const a = api("Summarizer")!;
    const s = (await a.create({ type: "tldr", format: "plain-text", length: "short" })) as {
      summarize: (input: string) => Promise<string>;
    };
    return (await s.summarize(text)).trim();
  }
  return collect(fallback, `Summarize the following concisely:\n\n${text}`, opts);
}

/** Tighten/restyle prose. Rewriter API (origin trial) or Prompt-API fallback. */
export async function rewriteProse(
  fallback: LLMProvider,
  draft: string,
  instruction: string,
  opts: GenerateOptions = {},
): Promise<string> {
  if (await isReady("Rewriter")) {
    const a = api("Rewriter")!;
    const r = (await a.create({ sharedContext: instruction })) as {
      rewrite: (input: string, opts?: { context?: string }) => Promise<string>;
    };
    return (await r.rewrite(draft, { context: instruction })).trim();
  }
  return collect(fallback, `Rewrite the text. ${instruction}\n\nText:\n${draft}`, opts);
}

/**
 * Polish spelling/grammar. Proofreader API (origin trial) only — there is no
 * Prompt-API fallback because the input is already verified prose and an
 * unconstrained rewrite could change meaning/numbers. Returns input unchanged.
 */
export async function proofread(_fallback: LLMProvider, text: string): Promise<string> {
  if (await isReady("Proofreader")) {
    const a = api("Proofreader")!;
    const p = (await a.create()) as {
      proofread: (input: string) => Promise<{ correctedInput?: string }>;
    };
    const res = await p.proofread(text);
    return (res.correctedInput ?? text).trim();
  }
  return text;
}
