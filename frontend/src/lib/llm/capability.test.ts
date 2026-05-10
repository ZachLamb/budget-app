import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getCapability, _resetCapabilityCache } from "./capability";

interface MutableGlobal {
  LanguageModel?: { availability?: () => Promise<string> };
}

describe("capability detection", () => {
  beforeEach(() => {
    _resetCapabilityCache();
    delete (globalThis as MutableGlobal).LanguageModel;
    // navigator.gpu is read-only in some envs; assign defensively.
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
  });
  afterEach(() => {
    _resetCapabilityCache();
    vi.restoreAllMocks();
  });

  it("reports nano unsupported when LanguageModel is missing", async () => {
    const cap = await getCapability(true);
    expect(cap.nano.available).toBe(false);
    expect(cap.nano.status).toBe("unsupported");
  });

  it("reports nano available when availability() returns 'available'", async () => {
    (globalThis as MutableGlobal).LanguageModel = {
      availability: async () => "available",
    };
    const cap = await getCapability(true);
    expect(cap.nano.available).toBe(true);
    expect(cap.nano.status).toBe("available");
  });

  it("reports nano downloadable when availability() returns 'downloadable'", async () => {
    (globalThis as MutableGlobal).LanguageModel = {
      availability: async () => "downloadable",
    };
    const cap = await getCapability(true);
    expect(cap.nano.available).toBe(true);
    expect(cap.nano.status).toBe("downloadable");
  });

  it("treats availability() throw as unsupported", async () => {
    (globalThis as MutableGlobal).LanguageModel = {
      availability: async () => {
        throw new Error("denied");
      },
    };
    const cap = await getCapability(true);
    expect(cap.nano.status).toBe("unsupported");
  });

  it("reports webgpu unavailable when navigator.gpu is missing", async () => {
    const cap = await getCapability(true);
    expect(cap.webgpu.available).toBe(false);
    expect(cap.webgpu.modelSize).toBe("none");
  });

  it("memoizes the result across calls", async () => {
    const fn = vi.fn(async () => "available");
    (globalThis as MutableGlobal).LanguageModel = { availability: fn };
    await getCapability(true);
    await getCapability();
    await getCapability();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("re-probes when force=true", async () => {
    const fn = vi.fn(async () => "available");
    (globalThis as MutableGlobal).LanguageModel = { availability: fn };
    await getCapability(true);
    await getCapability(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
