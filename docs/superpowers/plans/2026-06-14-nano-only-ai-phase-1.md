# Nano-only AI — Phase 1: Fix the foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini Nano actually work for the five light features — real setup/progress/error UX, schema-constrained structured output, a Nano-aware settings card, hidden tier jargon — and stand up the specialized-API capability probes + origin-trial token wiring. The cloud tier stays live (no broken window); nothing is deleted in this phase.

**Architecture:** Extend the existing tiered router/provider/capability stack in `frontend/src/lib/llm/`. Add a `needs_nano_setup` router decision so Chrome's model download is only ever triggered from an explicit user gesture. Add schema-constrained generation on Nano (`responseConstraint`). Add a `specialized` capability field + a `specialized.ts` helper module (availability + Prompt-API fallback) ready for Phase 2 pipelines.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest + Testing Library, Chrome `LanguageModel` Prompt API, Chrome Summarizer/Writer/Rewriter/Proofreader APIs.

**Spec:** `docs/superpowers/specs/2026-06-14-nano-only-ai-design.md` (Phase 1).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/lib/llm/types.ts` | Shared types; add `schema`/`temperature`/`topK` to `GenerateOptions`, `specialized` to `CapabilitySnapshot`, `NanoSetupState`. | Modify |
| `frontend/src/lib/llm/capability.ts` | Add `probeSpecialized()` + `specialized` field. | Modify |
| `frontend/src/lib/llm/providers/nano.ts` | Add `ensureReady()` (monitor download progress/errors), `schema` → `responseConstraint`, per-call `temperature`/`topK`. | Modify |
| `frontend/src/lib/llm/specialized.ts` | Capability-detected Summarizer/Writer/Rewriter/Proofreader wrappers with Prompt-API fallback. | Create |
| `frontend/src/lib/llm/router.ts` | Add `needs_nano_setup` decision. | Modify |
| `frontend/src/lib/llm/run-structured.ts` | Pass per-feature JSON schema to Nano via `GenerateOptions.schema`. | Modify |
| `frontend/src/lib/llm/schema.ts` | Per-feature JSON schemas (light features in Phase 1). | Create |
| `frontend/src/app/layout.tsx` | Inject `<meta http-equiv="origin-trial">` from `NEXT_PUBLIC_CHROME_AI_OT_TOKEN`. | Modify |
| `frontend/.env.example` | Document `NEXT_PUBLIC_CHROME_AI_OT_TOKEN` (empty default). | Modify |
| `frontend/src/components/llm/ai-settings-card.tsx` | Add Nano-aware status block (ready / downloadable+progress / WebGPU-only / none). | Modify |
| `frontend/src/components/llm/explain-charge.tsx` | Hide the tier badge (jargon). | Modify |
| `frontend/src/hooks/use-local-ai-setup.ts` | Add Nano setup path (call `nanoProvider.ensureReady`). | Modify |

**Out of scope for Phase 1 (Phase 2):** deleting `server.ts`/PII/consent dialogs, removing the Cloud AI settings section, collapsing explain-charge's cloud plumbing, backend deletions, the heavy pipelines.

---

## Task 1: Add `specialized` to the capability snapshot

**Files:**
- Modify: `frontend/src/lib/llm/types.ts:37-51`
- Modify: `frontend/src/lib/llm/capability.ts`
- Test: `frontend/src/lib/llm/capability.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/llm/capability.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCapability, _resetCapabilityCache } from "./capability";

describe("probeSpecialized", () => {
  afterEach(() => {
    _resetCapabilityCache();
    delete (globalThis as Record<string, unknown>).Summarizer;
    delete (globalThis as Record<string, unknown>).Writer;
    delete (globalThis as Record<string, unknown>).Rewriter;
    delete (globalThis as Record<string, unknown>).Proofreader;
  });

  it("reports each specialized API as available when its global exposes availability()=available", async () => {
    const avail = { availability: vi.fn().mockResolvedValue("available") };
    (globalThis as Record<string, unknown>).Summarizer = avail;
    (globalThis as Record<string, unknown>).Writer = avail;
    (globalThis as Record<string, unknown>).Rewriter = avail;
    (globalThis as Record<string, unknown>).Proofreader = avail;

    const cap = await getCapability(true);

    expect(cap.specialized).toEqual({
      summarizer: true,
      writer: true,
      rewriter: true,
      proofreader: true,
    });
  });

  it("defaults every specialized flag to false when the globals are absent", async () => {
    const cap = await getCapability(true);
    expect(cap.specialized).toEqual({
      summarizer: false,
      writer: false,
      rewriter: false,
      proofreader: false,
    });
  });

  it("treats availability()=downloadable as not-yet-available (false)", async () => {
    (globalThis as Record<string, unknown>).Summarizer = {
      availability: vi.fn().mockResolvedValue("downloadable"),
    };
    const cap = await getCapability(true);
    expect(cap.specialized.summarizer).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/llm/capability.test.ts`
Expected: FAIL — `cap.specialized` is `undefined`.

- [ ] **Step 3: Add the type**

In `frontend/src/lib/llm/types.ts`, extend `CapabilitySnapshot` (after the `server` field, keep `server` for now — cloud is live through Phase 1):

```typescript
  /** Tier 4 — server is reachable when user opts in. Always true at the network layer; consent is the gate. */
  server: { available: boolean };
  /**
   * Specialized on-device Chrome AI APIs. All optional — a false flag just
   * means a pipeline step uses the Prompt API instead. Never blocks a feature.
   */
  specialized: {
    summarizer: boolean;
    writer: boolean;
    rewriter: boolean;
    proofreader: boolean;
  };
```

- [ ] **Step 4: Implement the probe**

In `frontend/src/lib/llm/capability.ts`, add the probe and wire it into `emptySnapshot()` + `getCapability()`:

```typescript
async function probeOne(name: "Summarizer" | "Writer" | "Rewriter" | "Proofreader"): Promise<boolean> {
  const api = (globalThis as unknown as Record<string, { availability?: () => Promise<string> }>)[name];
  if (!api || typeof api.availability !== "function") return false;
  try {
    return (await api.availability()) === "available";
  } catch {
    return false;
  }
}

async function probeSpecialized(): Promise<CapabilitySnapshot["specialized"]> {
  const [summarizer, writer, rewriter, proofreader] = await Promise.all([
    probeOne("Summarizer"),
    probeOne("Writer"),
    probeOne("Rewriter"),
    probeOne("Proofreader"),
  ]);
  return { summarizer, writer, rewriter, proofreader };
}
```

Update `emptySnapshot()` to include `specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false }`.

Update the `getCapability()` inflight block:

```typescript
    const [nano, webgpu, specialized] = await Promise.all([probeNano(), probeWebGPU(), probeSpecialized()]);
    const snapshot: CapabilitySnapshot = {
      nano,
      webgpu,
      server: { available: true },
      specialized,
    };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/llm/capability.test.ts`
Expected: PASS (all probeSpecialized tests + the existing nano/webgpu tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/llm/types.ts frontend/src/lib/llm/capability.ts frontend/src/lib/llm/capability.test.ts
git commit -m "feat(llm): probe specialized Chrome AI API availability"
```

---

## Task 2: Specialized-API helpers with Prompt-API fallback

**Files:**
- Create: `frontend/src/lib/llm/specialized.ts`
- Test: `frontend/src/lib/llm/specialized.test.ts`

The wrappers take an `LLMProvider` (Nano) for the fallback path. Each `*.isAvailable()` reads the capability snapshot; when the specialized API is absent the helper runs a Prompt-API generate with an inline instruction. This module is created now so Phase 2 pipelines can call it; Phase 1 only needs availability + fallback correctness.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/llm/specialized.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { summarize, rewriteProse, proofread } from "./specialized";
import type { LLMProvider } from "./types";

function fakeNano(output: string): LLMProvider {
  return {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {
      yield output;
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Summarizer;
  delete (globalThis as Record<string, unknown>).Rewriter;
  delete (globalThis as Record<string, unknown>).Proofreader;
});

describe("summarize", () => {
  it("uses the Summarizer API when available", async () => {
    const summarizer = { summarize: vi.fn().mockResolvedValue("short") };
    (globalThis as Record<string, unknown>).Summarizer = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(summarizer),
    };
    const out = await summarize(fakeNano("FALLBACK"), "long text", { signal: undefined });
    expect(out).toBe("short");
    expect(summarizer.summarize).toHaveBeenCalledWith("long text");
  });

  it("falls back to the Prompt API when Summarizer is absent", async () => {
    const out = await summarize(fakeNano("prompt summary"), "long text", { signal: undefined });
    expect(out).toBe("prompt summary");
  });
});

describe("rewriteProse", () => {
  it("falls back to the Prompt API when Rewriter is absent", async () => {
    const out = await rewriteProse(fakeNano("rewritten"), "draft", "make it concise", {});
    expect(out).toBe("rewritten");
  });
});

describe("proofread", () => {
  it("returns the input unchanged when Proofreader is absent (no fallback model call)", async () => {
    const nano = fakeNano("SHOULD_NOT_BE_USED");
    const out = await proofread(nano, "teh cat");
    expect(out).toBe("teh cat");
  });

  it("uses the Proofreader API correction when available", async () => {
    const pf = { proofread: vi.fn().mockResolvedValue({ correctedInput: "the cat" }) };
    (globalThis as Record<string, unknown>).Proofreader = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(pf),
    };
    const out = await proofread(fakeNano("x"), "teh cat");
    expect(out).toBe("the cat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/llm/specialized.test.ts`
Expected: FAIL — module `./specialized` not found.

- [ ] **Step 3: Implement `specialized.ts`**

Create `frontend/src/lib/llm/specialized.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/llm/specialized.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/llm/specialized.ts frontend/src/lib/llm/specialized.test.ts
git commit -m "feat(llm): specialized AI helpers with Prompt-API fallback"
```

---

## Task 3: Origin-trial token meta tag + env documentation

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/.env.example`

- [ ] **Step 1: Read the current layout head**

Run: `cd frontend && npx vitest run --silent` is not needed here. First read the file to find the `<head>`/metadata region.

Read: `frontend/src/app/layout.tsx` and locate where `<html>`/`<head>`/`<body>` are rendered.

- [ ] **Step 2: Inject the meta tag (only when the env var is set)**

In `frontend/src/app/layout.tsx`, inside the `<head>` (add a `<head>` element if the layout uses the App Router `<html><body>` shape — App Router allows a `<head>` child or you can render the tag at the top of `<body>`; the origin-trial meta must be in `<head>`), add:

```tsx
{process.env.NEXT_PUBLIC_CHROME_AI_OT_TOKEN ? (
  <meta
    httpEquiv="origin-trial"
    content={process.env.NEXT_PUBLIC_CHROME_AI_OT_TOKEN}
  />
) : null}
```

If the layout currently has no explicit `<head>`, add one:

```tsx
<html lang="en">
  <head>
    {process.env.NEXT_PUBLIC_CHROME_AI_OT_TOKEN ? (
      <meta httpEquiv="origin-trial" content={process.env.NEXT_PUBLIC_CHROME_AI_OT_TOKEN} />
    ) : null}
  </head>
  <body>{/* existing children */}</body>
</html>
```

- [ ] **Step 3: Document the env var**

In `frontend/.env.example`, add (empty default — this is a public, origin-bound token, not a secret):

```bash
# Chrome built-in AI origin-trial token for the Writer/Rewriter/Proofreader APIs.
# Public, origin-bound, embedded in HTML. Leave empty to disable those APIs
# (pipelines fall back to the Prompt API). Get one at:
# https://developer.chrome.com/origintrials
NEXT_PUBLIC_CHROME_AI_OT_TOKEN=
```

- [ ] **Step 4: Verify the build is clean**

Run: `cd frontend && npm run lint`
Expected: no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/layout.tsx frontend/.env.example
git commit -m "feat(llm): wire Chrome AI origin-trial token via public env var"
```

---

## Task 4: Nano `ensureReady()` + schema + per-call temperature

**Files:**
- Modify: `frontend/src/lib/llm/types.ts:17-23`
- Modify: `frontend/src/lib/llm/providers/nano.ts`
- Create: `frontend/src/lib/llm/providers/nano.test.ts`

- [ ] **Step 1: Extend `GenerateOptions`**

In `frontend/src/lib/llm/types.ts`, add to `GenerateOptions`:

```typescript
export interface GenerateOptions {
  signal?: AbortSignal;
  /** Soft cap; provider may produce fewer tokens. (No-op on Nano.) */
  maxTokens?: number;
  /** Override the system prompt for this call. */
  system?: string;
  /** JSON schema for structured output (Nano `responseConstraint`). */
  schema?: Record<string, unknown>;
  /** Sampling temperature for this call (raise only for sampling steps). */
  temperature?: number;
  /** Top-K for this call; set together with temperature. */
  topK?: number;
}
```

Add a setup-state type at the bottom of `types.ts`:

```typescript
export type NanoSetupState =
  | { kind: "ready" }
  | { kind: "downloading"; progress: number }
  | { kind: "error"; message: string };
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/lib/llm/providers/nano.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { nanoProvider, _resetNanoForTest } from "./nano";

function installNano(opts: {
  availability?: string;
  onCreate?: (o: unknown) => void;
  monitorEvents?: { loaded: number }[];
}) {
  const create = vi.fn(async (o: { monitor?: (m: EventTarget) => void }) => {
    opts.onCreate?.(o);
    if (o.monitor && opts.monitorEvents) {
      const target = new EventTarget();
      o.monitor(target);
      for (const ev of opts.monitorEvents) {
        const e = new Event("downloadprogress") as Event & { loaded: number };
        (e as { loaded: number }).loaded = ev.loaded;
        target.dispatchEvent(e);
      }
    }
    return {
      promptStreaming: async function* () {
        yield "ok";
      },
      destroy: vi.fn(),
    };
  });
  (globalThis as Record<string, unknown>).LanguageModel = {
    availability: vi.fn().mockResolvedValue(opts.availability ?? "available"),
    create,
  };
  return { create };
}

afterEach(() => {
  _resetNanoForTest();
  delete (globalThis as Record<string, unknown>).LanguageModel;
});

describe("nanoProvider.ensureReady", () => {
  it("reports download progress via the monitor hook and resolves ready", async () => {
    installNano({ availability: "downloadable", monitorEvents: [{ loaded: 0.5 }, { loaded: 1 }] });
    const seen: number[] = [];
    const state = await nanoProvider.ensureReady((p) => seen.push(p));
    expect(seen).toEqual([0.5, 1]);
    expect(state).toEqual({ kind: "ready" });
  });

  it("returns an error state when create() throws", async () => {
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: vi.fn().mockRejectedValue(new Error("disk full")),
    };
    const state = await nanoProvider.ensureReady();
    expect(state.kind).toBe("error");
  });
});

describe("nanoProvider.generate with schema", () => {
  it("passes the schema as responseConstraint", async () => {
    let captured: Record<string, unknown> | undefined;
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(async () => ({
        promptStreaming: (_p: string, o?: Record<string, unknown>) => {
          captured = o;
          return (async function* () {
            yield "{}";
          })();
        },
        destroy: vi.fn(),
      })),
    };
    const schema = { type: "object" };
    const out: string[] = [];
    for await (const c of nanoProvider.generate("p", { schema })) out.push(c);
    expect(captured?.responseConstraint).toEqual(schema);
    expect(captured?.omitResponseConstraintInput).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/llm/providers/nano.test.ts`
Expected: FAIL — `ensureReady`/`_resetNanoForTest` not exported.

- [ ] **Step 4: Implement in `nano.ts`**

Replace `frontend/src/lib/llm/providers/nano.ts` with:

```typescript
/**
 * Tier 1 — Chrome/Edge built-in Gemini Nano via the Prompt API (`LanguageModel`).
 *
 * Sessions are reused across calls to avoid paying warm-up twice. Download is
 * only ever triggered from an explicit user gesture (see router needs_nano_setup).
 */

import type { GenerateOptions, LLMProvider, NanoSetupState } from "../types";

interface NanoSession {
  promptStreaming(
    input: string,
    opts?: { signal?: AbortSignal; responseConstraint?: Record<string, unknown>; omitResponseConstraintInput?: boolean },
  ): AsyncIterable<string>;
  destroy?: () => void;
}

interface CreateOpts {
  initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  topK?: number;
  monitor?: (m: EventTarget) => void;
}

interface NanoNamespace {
  availability: () => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create: (opts?: CreateOpts) => Promise<NanoSession>;
}

function nano(): NanoNamespace | null {
  const lm = (globalThis as unknown as { LanguageModel?: NanoNamespace }).LanguageModel;
  return lm ?? null;
}

let cached: NanoSession | null = null;
let cachedKey: string | null = null;

function sessionKey(system: string | undefined, temperature: number, topK: number): string {
  return `${system ?? ""}::${temperature}::${topK}`;
}

async function ensureSession(opts: GenerateOptions, monitor?: (p: number) => void): Promise<NanoSession> {
  const temperature = opts.temperature ?? 0.3;
  const topK = opts.topK ?? 3;
  const key = sessionKey(opts.system, temperature, topK);
  if (cached && cachedKey === key) return cached;
  if (cached?.destroy) {
    try {
      cached.destroy();
    } catch {
      // ignore
    }
  }
  const ns = nano();
  if (!ns) throw new Error("Gemini Nano (LanguageModel) is not available in this browser.");
  const session = await ns.create({
    initialPrompts: opts.system ? [{ role: "system", content: opts.system }] : undefined,
    temperature,
    topK,
    monitor: monitor
      ? (m: EventTarget) => {
          m.addEventListener("downloadprogress", (e: Event) => {
            const loaded = (e as Event & { loaded?: number }).loaded;
            if (typeof loaded === "number") monitor(loaded);
          });
        }
      : undefined,
  });
  cached = session;
  cachedKey = key;
  return session;
}

class NanoProvider implements LLMProvider {
  readonly name = "nano" as const;
  readonly tier = 1 as const;
  readonly privacy = "local" as const;

  /**
   * Await model readiness, wiring the download `monitor` for progress.
   * MUST be called from a user gesture (download requires user activation).
   */
  async ensureReady(onProgress?: (progress: number) => void): Promise<NanoSetupState> {
    try {
      await ensureSession({}, onProgress);
      return { kind: "ready" };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "Setup failed." };
    }
  }

  async *generate(prompt: string, opts: GenerateOptions = {}): AsyncIterable<string> {
    const session = await ensureSession(opts);
    yield* session.promptStreaming(prompt, {
      signal: opts.signal,
      responseConstraint: opts.schema,
      omitResponseConstraintInput: opts.schema ? true : undefined,
    });
  }
}

export const nanoProvider: LLMProvider & {
  ensureReady(onProgress?: (progress: number) => void): Promise<NanoSetupState>;
} = new NanoProvider();

export function _resetNanoForTest(): void {
  cached = null;
  cachedKey = null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/llm/providers/nano.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/llm/types.ts frontend/src/lib/llm/providers/nano.ts frontend/src/lib/llm/providers/nano.test.ts
git commit -m "feat(llm): Nano ensureReady() progress + schema-constrained output"
```

---

## Task 5: Router `needs_nano_setup` decision

**Files:**
- Modify: `frontend/src/lib/llm/router.ts:15-33,95-151`
- Test: `frontend/src/lib/llm/router.test.ts`

When Nano is the chosen tier but its status is `"downloadable"` (or `"downloading"`), return `needs_nano_setup` instead of instantiating the provider — so the model fetch is only kicked off by an explicit user action.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/llm/router.test.ts` (match the existing fake-capability + fake-provider patterns in that file):

```typescript
import { describe, expect, it, vi } from "vitest";
import { decide, type RouterContext } from "./router";
import type { CapabilitySnapshot } from "./types";

function cap(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    nano: { available: true, status: "available" },
    webgpu: { available: false, modelSize: "none" },
    server: { available: true },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
    ...overrides,
  };
}

function ctx(): RouterContext {
  const provider = { name: "nano", tier: 1, privacy: "local", async *generate() {} } as never;
  return {
    aiEnabledGlobally: true,
    cloudConsentGrants: new Set(),
    providers: {
      nano: vi.fn().mockResolvedValue(provider),
      webLlm: vi.fn().mockResolvedValue(provider),
      server: vi.fn().mockResolvedValue(provider),
    },
  };
}

describe("decide — needs_nano_setup", () => {
  it("returns needs_nano_setup when Nano is the pick but status is downloadable", async () => {
    const c = ctx();
    const d = await decide("explain_charge", c, cap({ nano: { available: true, status: "downloadable" } }));
    expect(d.kind).toBe("needs_nano_setup");
    expect(c.providers.nano).not.toHaveBeenCalled();
  });

  it("returns ready (and instantiates Nano) when status is available", async () => {
    const c = ctx();
    const d = await decide("explain_charge", c, cap());
    expect(d.kind).toBe("ready");
    expect(c.providers.nano).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/llm/router.test.ts`
Expected: FAIL — `needs_nano_setup` is not a valid `Decision.kind` / not produced.

- [ ] **Step 3: Extend the `Decision` type**

In `frontend/src/lib/llm/router.ts`, add a variant to `Decision`:

```typescript
  | {
      kind: "needs_nano_setup";
      tier: 1;
      reason: "needs_nano_setup";
      message: string;
    }
```

- [ ] **Step 4: Add the branch in `decide()`**

In `router.ts`, after the tier is picked and before the Tier-2 consent check, insert:

```typescript
  // Nano selected but the model isn't downloaded yet — require an explicit
  // user gesture to start the fetch (never auto-trigger Chrome's download).
  if (tier === 1 && (cap.nano.status === "downloadable" || cap.nano.status === "downloading")) {
    return {
      kind: "needs_nano_setup",
      tier: 1,
      reason: "needs_nano_setup",
      message: "On-device AI needs a quick one-time setup.",
    };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/llm/router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/llm/router.ts frontend/src/lib/llm/router.test.ts
git commit -m "feat(llm): add needs_nano_setup router decision (no silent download)"
```

---

## Task 6: Per-feature JSON schemas + schema-constrained light features

**Files:**
- Create: `frontend/src/lib/llm/schema.ts`
- Modify: `frontend/src/lib/llm/run-structured.ts`
- Test: `frontend/src/lib/llm/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/llm/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { schemaForFeature } from "./schema";

describe("schemaForFeature", () => {
  it("returns a JSON schema for fsa_review", () => {
    const s = schemaForFeature("fsa_review");
    expect(s).toBeDefined();
    expect(s?.type).toBe("object");
  });

  it("returns a JSON schema for categorize_transaction", () => {
    const s = schemaForFeature("categorize_transaction");
    expect(s).toBeDefined();
  });

  it("returns undefined for features without a structured schema", () => {
    expect(schemaForFeature("explain_charge")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/llm/schema.test.ts`
Expected: FAIL — module `./schema` not found.

- [ ] **Step 3: Implement `schema.ts`**

Create `frontend/src/lib/llm/schema.ts` (schemas mirror the parsers in `contracts.ts`):

```typescript
import type { FeatureId } from "./features";

/**
 * JSON schemas for structured features, fed to Nano via `responseConstraint`.
 * Only the structured features have one; free-text features return undefined.
 */
const SCHEMAS: Partial<Record<FeatureId, Record<string, unknown>>> = {
  fsa_review: {
    type: "object",
    required: ["eligible"],
    additionalProperties: false,
    properties: {
      eligible: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "confidence", "fsa_category", "reason"],
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            fsa_category: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
  categorize_transaction: {
    type: "array",
    items: {
      type: "object",
      required: ["transaction_id", "category_id"],
      additionalProperties: false,
      properties: {
        transaction_id: { type: "string" },
        category_id: { type: "string" },
      },
    },
  },
};

export function schemaForFeature(feature: FeatureId): Record<string, unknown> | undefined {
  return SCHEMAS[feature];
}
```

- [ ] **Step 4: Wire the schema into `run-structured.ts`**

In `frontend/src/lib/llm/run-structured.ts`, import `schemaForFeature` and pass it on Nano (Tier 1) calls. Find where `provider.generate(...)` is invoked inside `collectStream`/`runStructuredJson` and add the schema only for the Nano provider:

```typescript
import { schemaForFeature } from "./schema";

// ...where the generate options are built for a single structured call:
const schema = provider.tier === 1 ? schemaForFeature(feature) : undefined;
const stream = provider.generate(opts.prompt, {
  system: opts.system,
  maxTokens: opts.maxTokens,
  signal: opts.signal,
  schema,
});
```

Keep the existing free-text `parseJsonResponse` retry path for Tier 2 (web-llm) unchanged — schema is Nano-only.

- [ ] **Step 5: Add a test that Nano calls receive a schema**

Add to `frontend/src/lib/llm/run-structured.test.ts` an integration-style test with a fake Tier-1 provider that records its `generate` options, asserting `schema` is passed for `fsa_review` and **not** passed for a Tier-2 provider. (Follow the existing fake-provider pattern; record the second argument of `generate`.)

```typescript
it("passes a JSON schema to Tier-1 (Nano) structured calls", async () => {
  let opts: Record<string, unknown> | undefined;
  const nano = {
    name: "nano", tier: 1, privacy: "local",
    generate: (_p: string, o?: Record<string, unknown>) => {
      opts = o;
      return (async function* () { yield '{"eligible":[]}'; })();
    },
  } as never;
  // build a RouterContext whose decide() resolves to this provider as tier 1
  // (reuse the test helpers already in this file), then:
  // await runStructuredJson("fsa_review", ctx, { system: "s", prompt: "p" });
  // expect((opts as { schema?: unknown }).schema).toBeDefined();
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/llm/schema.test.ts src/lib/llm/run-structured.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/llm/schema.ts frontend/src/lib/llm/schema.test.ts frontend/src/lib/llm/run-structured.ts frontend/src/lib/llm/run-structured.test.ts
git commit -m "feat(llm): schema-constrained structured output on Nano for light features"
```

---

## Task 7: Nano setup path in the local-AI setup hook

**Files:**
- Modify: `frontend/src/hooks/use-local-ai-setup.ts`
- Test: `frontend/src/hooks/use-local-ai-setup.test.ts`

The wizard currently downloads the web-llm model. Add a branch so that when the chosen tier is Nano (status `downloadable`), `ensureReady` runs the Chrome model download and reports progress, then re-probes capability.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/hooks/use-local-ai-setup.test.ts` a test that mocks `nanoProvider.ensureReady` to invoke its progress callback and resolve `{ kind: "ready" }`, then asserts the hook surfaces progress and a ready state, and calls `getCapability(true)` to re-probe. Mock modules:

```typescript
vi.mock("@/lib/llm/providers/nano", () => ({
  nanoProvider: {
    name: "nano", tier: 1, privacy: "local",
    generate: vi.fn(),
    ensureReady: vi.fn(async (cb?: (p: number) => void) => {
      cb?.(0.5);
      cb?.(1);
      return { kind: "ready" };
    }),
  },
}));
vi.mock("@/lib/llm/capability", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...mod, getCapability: vi.fn().mockResolvedValue({
    nano: { available: true, status: "available" },
    webgpu: { available: false, modelSize: "none" },
    server: { available: true },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
  }) };
});
```

Assert: after invoking the hook's Nano setup action, progress reaches `1` and the state is ready.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/use-local-ai-setup.test.ts`
Expected: FAIL — hook has no Nano setup branch.

- [ ] **Step 3: Implement the Nano branch**

In `frontend/src/hooks/use-local-ai-setup.ts`, add a function that, when the capability shows Nano `downloadable`, calls `nanoProvider.ensureReady(setProgress)` and on `{ kind: "ready" }` calls `await getCapability(true)` then marks done; on `{ kind: "error" }` surfaces `formatWebLlmDownloadError`-equivalent message. Keep the existing web-llm path for the WebGPU-only case. (Match the existing state-machine shape in this hook.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/use-local-ai-setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-local-ai-setup.ts frontend/src/hooks/use-local-ai-setup.test.ts
git commit -m "feat(llm): Nano download path in local AI setup hook"
```

---

## Task 8: Nano-aware settings status block + hide tier badge

**Files:**
- Modify: `frontend/src/components/llm/ai-settings-card.tsx`
- Modify: `frontend/src/components/llm/explain-charge.tsx`
- Test: `frontend/src/components/llm/ai-settings-card.test.tsx` (create if absent)

Phase 1 **adds** the Nano-aware status block and hides tier jargon. It does **not** remove the Cloud AI section (that is Phase 2, with cloud deletion).

- [ ] **Step 1: Write the failing component test**

Create/extend `frontend/src/components/llm/ai-settings-card.test.tsx`. Mock `getCapability` to return each state and assert the rendered copy:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiSettingsCard } from "./ai-settings-card";

vi.mock("@/lib/llm/capability", () => ({
  getCapability: vi.fn(),
  _resetCapabilityCache: vi.fn(),
}));
import { getCapability } from "@/lib/llm/capability";

function renderCard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AiSettingsCard />
    </QueryClientProvider>,
  );
}

const base = {
  webgpu: { available: false, modelSize: "none" as const },
  server: { available: true },
  specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
};

describe("AiSettingsCard — Nano status", () => {
  it("shows 'On-device AI ready' when Nano is available", async () => {
    vi.mocked(getCapability).mockResolvedValue({ ...base, nano: { available: true, status: "available" } });
    renderCard();
    expect(await screen.findByText(/on-device ai ready/i)).toBeInTheDocument();
  });

  it("shows a Chrome/Edge hint when nothing is available", async () => {
    vi.mocked(getCapability).mockResolvedValue({ ...base, nano: { available: false, status: "unsupported" } });
    renderCard();
    expect(await screen.findByText(/chrome or edge on desktop/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/llm/ai-settings-card.test.tsx`
Expected: FAIL — copy not present.

- [ ] **Step 3: Add the Nano status block**

In `frontend/src/components/llm/ai-settings-card.tsx`, add a status region driven by `getCapability()`:

- `nano.status === "available"` → `<p role="status">On-device AI ready</p>` (no action).
- `nano.status === "downloadable" | "downloading"` → "Setting up on-device AI…" + a user-gesture button calling `ensureLocalSetup(...)` + live progress.
- `!nano.available && webgpu.modelSize !== "none"` → existing quiet "Download fallback model (1.8 GB)".
- neither → `<p role="status">On-device AI needs Chrome or Edge on desktop</p>` (no dead button).

Keep the existing Cloud AI section untouched in Phase 1.

- [ ] **Step 4: Hide the tier badge in explain-charge**

In `frontend/src/components/llm/explain-charge.tsx`, remove the tier badge element (the `Tier {tier}` / provider-name UI). Leave the cloud/PII/429 plumbing in place for Phase 1 (removed in Phase 2). This is a pure deletion of the jargon badge.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/llm/ai-settings-card.test.tsx src/components/llm/explain-charge.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/llm/ai-settings-card.tsx frontend/src/components/llm/ai-settings-card.test.tsx frontend/src/components/llm/explain-charge.tsx
git commit -m "feat(llm): Nano-aware settings status; hide tier jargon"
```

---

## Task 9: Phase 1 verification gate

- [ ] **Step 1: Frontend quality gate**

Run: `cd frontend && npm run quality:check`
Expected: lint clean, all Vitest suites pass, no new fallow dead-code.

- [ ] **Step 2: Build gate**

Run: `cd frontend && npm run build`
Expected: successful production build.

- [ ] **Step 3: Manual smoke (documented, not automated)**

On Chrome desktop with Nano available: open Settings → see "On-device AI ready". Trigger a light feature (explain a charge) → streams a result with no tier badge. On a browser without Nano → Settings shows the Chrome/Edge hint; the feature shows a clean unavailable/cloud path (cloud still live in Phase 1).

- [ ] **Step 4: Commit any fixes from the gate, then stop.**

Phase 1 is complete when `quality:check` and `build` pass. Do not start Phase 2 deletions here.

---

## Self-Review (run after implementing)

1. **Spec coverage (Phase 1):** Nano `ensureReady` progress/error ✓ (Task 4); `needs_nano_setup` ✓ (Task 5); schema-constrained light features ✓ (Task 6); specialized capability probes + token wiring ✓ (Tasks 1–3); Nano-aware settings + hidden tier labels ✓ (Task 8); cloud untouched ✓ (no deletions). 
2. **Type consistency:** `GenerateOptions.schema` (Task 4) is the same field read in `run-structured.ts` (Task 6) and `nano.ts` `responseConstraint`. `CapabilitySnapshot.specialized` shape (Task 1) matches `specialized.ts` probes (Task 2) and the router/test fakes (Task 5). `NanoSetupState` (Task 4) is the return of `ensureReady` consumed by the hook (Task 7).
3. **No placeholders:** every code step ships real code; the two component/hook tasks reference the existing test patterns rather than re-inventing them.
