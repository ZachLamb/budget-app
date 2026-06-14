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
