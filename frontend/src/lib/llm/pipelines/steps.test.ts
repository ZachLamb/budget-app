import { describe, expect, it, vi } from "vitest";
import { OnDeviceError } from "../errors";
import type { LLMProvider } from "../types";

vi.mock("@/lib/api/client", () => ({
  default: { get: vi.fn() },
}));

import api from "@/lib/api/client";
import { generateStructured, ground, verify } from "./steps";

function fake(out: string): LLMProvider {
  return {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {
      yield out;
    },
  };
}

describe("generateStructured", () => {
  it("parses schema-constrained JSON", async () => {
    const v = await generateStructured(fake('{"a":1}'), {
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    });
    expect(v).toEqual({ a: 1 });
  });

  it("throws schema_parse_failed on non-JSON", async () => {
    await expect(
      generateStructured(fake("not json"), {
        system: "s",
        prompt: "p",
        schema: {},
      }),
    ).rejects.toMatchObject({ code: "schema_parse_failed" });
  });

  it("only forwards the schema to Tier 1", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const recording = (tier: 1 | 2): LLMProvider => ({
      name: tier === 1 ? "nano" : "web-llm",
      tier,
      privacy: "local",
      async *generate(_prompt, opts) {
        seen.push(opts?.schema);
        yield '{"a":1}';
      },
    });
    await generateStructured(recording(1), {
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    });
    await generateStructured(recording(2), {
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    });
    expect(seen[0]).toEqual({ type: "object" });
    expect(seen[1]).toBeUndefined();
  });
});

describe("verify", () => {
  it("throws verify_failed when a check fails", () => {
    expect(() => verify({ x: 1 }, [() => false])).toThrow(OnDeviceError);
  });
  it("returns the result when all checks pass", () => {
    expect(verify({ x: 1 }, [() => true])).toEqual({ x: 1 });
  });
});

describe("ground", () => {
  it("returns the fact payload from the client", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { month: "2026-06" } });
    const facts = await ground<{ month: string }>("/ai/facts/budget");
    expect(facts).toEqual({ month: "2026-06" });
    expect(api.get).toHaveBeenCalledWith("/ai/facts/budget", {
      signal: undefined,
    });
  });

  it("throws facts_unavailable when the fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("network"));
    await expect(ground("/ai/facts/budget")).rejects.toMatchObject({
      code: "facts_unavailable",
    });
  });
});

describe("ground error taxonomy", () => {
  it("throws facts_unavailable when the fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("network down"));
    await expect(ground("/ai/facts/context")).rejects.toMatchObject({
      code: "facts_unavailable",
    });
  });
  it("throws aborted when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("canceled"));
    await expect(ground("/ai/facts/context", ctrl.signal)).rejects.toMatchObject({
      code: "aborted",
    });
  });
});

describe("generation progress reporting", () => {
  it("generateStructured reports cumulative character counts per chunk", async () => {
    const chunks = ['{"a"', ":1}"];
    const provider: LLMProvider = {
      name: "nano",
      tier: 1,
      privacy: "local",
      async *generate() {
        for (const c of chunks) yield c;
      },
    };
    const seen: number[] = [];
    await generateStructured(provider, {
      system: "s",
      prompt: "p",
      schema: { type: "object" },
      onToken: (n) => seen.push(n),
    });
    expect(seen).toEqual([4, 7]);
  });

  it("generateVerified emits retry and verify progress", async () => {
    const { generateVerified } = await import("./steps");
    let call = 0;
    const provider: LLMProvider = {
      name: "nano",
      tier: 1,
      privacy: "local",
      async *generate() {
        call += 1;
        yield call === 1 ? "not json" : '{"a":1}';
      },
    };
    const steps: string[] = [];
    const result = await generateVerified(
      provider,
      { system: "s", prompt: "p", schema: { type: "object" } },
      [],
      { onProgress: (p) => steps.push(`${p.step}:${p.label}`) },
    );
    expect(result).toEqual({ a: 1 });
    // Attempt 1 parse fails silently; attempt 2 announces the rewrite, then
    // the successful parse announces verification.
    expect(steps.some((s) => s.startsWith("generate:") && /attempt 2/i.test(s))).toBe(true);
    expect(steps.some((s) => s.startsWith("verify:"))).toBe(true);
  });
});
