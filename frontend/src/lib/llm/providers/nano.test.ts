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

function makeSession() {
  return {
    promptStreaming: () =>
      (async function* () {
        yield "ok";
      })(),
    destroy: vi.fn(),
  };
}

async function drain(it: AsyncIterable<string>): Promise<void> {
  const reader = it[Symbol.asyncIterator]();
  while (!(await reader.next()).done) {
    // consume all chunks
  }
}

describe("nanoProvider session caching", () => {
  it("reuses ONE session across two sequential generates with identical opts", async () => {
    const create = vi.fn(async () => makeSession());
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    };
    await drain(nanoProvider.generate("a", { temperature: 0.3, topK: 3 }));
    await drain(nanoProvider.generate("b", { temperature: 0.3, topK: 3 }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("creates a NEW session and destroys the old one when temperature changes", async () => {
    const sessions: ReturnType<typeof makeSession>[] = [];
    const create = vi.fn(async () => {
      const s = makeSession();
      sessions.push(s);
      return s;
    });
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    };
    await drain(nanoProvider.generate("a", { temperature: 0.3 }));
    await drain(nanoProvider.generate("b", { temperature: 0.9 }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(sessions[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent ensureReady() + generate() with the same key into one create", async () => {
    const create = vi.fn(async () => makeSession());
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
      create,
    };
    const p1 = nanoProvider.ensureReady();
    const p2 = drain(nanoProvider.generate("x"));
    await Promise.all([p1, p2]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
