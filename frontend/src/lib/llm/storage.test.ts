import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  MODEL_1B,
  MODEL_3B,
  _resetModelStatusCache,
  chooseModelId,
  clearModelFromCache,
  getModelDownloadStatus,
} from "./storage";
import { _resetCapabilityCache } from "./capability";
import { clearLocalConsent, setUseLiteModel } from "./consent";
import type { CapabilitySnapshot } from "./types";

const hasModelInCache = vi.fn<(modelId: string) => Promise<boolean>>();
const deleteModelAllInfoInCache = vi.fn<(modelId: string) => Promise<void>>();

vi.mock("@mlc-ai/web-llm", () => ({
  hasModelInCache: (modelId: string) => hasModelInCache(modelId),
  deleteModelAllInfoInCache: (modelId: string) => deleteModelAllInfoInCache(modelId),
}));

vi.mock("./capability", async () => {
  const actual = await vi.importActual<typeof import("./capability")>("./capability");
  return {
    ...actual,
    getCapability: () => Promise.resolve(currentCapability),
  };
});

let currentCapability: CapabilitySnapshot;

function setCapability(webgpu: CapabilitySnapshot["webgpu"]): void {
  currentCapability = {
    nano: { available: false, status: "unsupported" },
    webgpu,
    server: { available: true },
  };
}

/**
 * Node 24+ exposes a stub `globalThis.localStorage` that shadows jsdom's
 * Storage and lacks the `setItem` / `getItem` / `clear` methods. Install a
 * minimal Map-backed Storage on `window` for the duration of each test so
 * `consent.ts` can read/write without the swallowed-throw silent-failure path.
 */
function installStubStorage(): void {
  const map = new Map<string, string>();
  const stub = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
  } satisfies Storage;
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
}

describe("storage / on-device model cache", () => {
  beforeEach(() => {
    installStubStorage();
    _resetModelStatusCache();
    _resetCapabilityCache();
    hasModelInCache.mockReset();
    deleteModelAllInfoInCache.mockReset();
    setCapability({ available: true, modelSize: "3b" });
  });
  afterEach(() => {
    clearLocalConsent();
    _resetModelStatusCache();
    _resetCapabilityCache();
    vi.restoreAllMocks();
  });

  describe("chooseModelId", () => {
    it("returns the 3B id when capability says 3b", async () => {
      setCapability({ available: true, modelSize: "3b" });
      expect(await chooseModelId()).toBe(MODEL_3B);
    });

    it("returns the 1B id when capability says 1b", async () => {
      setCapability({ available: true, modelSize: "1b" });
      expect(await chooseModelId()).toBe(MODEL_1B);
    });

    it("returns the 1B id when user forces Lite even on 3B-capable hardware", async () => {
      setCapability({ available: true, modelSize: "3b" });
      setUseLiteModel(true);
      expect(await chooseModelId()).toBe(MODEL_1B);
    });

    it("returns null when WebGPU is unavailable", async () => {
      setCapability({ available: false, modelSize: "none" });
      expect(await chooseModelId()).toBeNull();
    });
  });

  describe("getModelDownloadStatus", () => {
    it("reports unsupported when WebGPU is unavailable", async () => {
      setCapability({ available: false, modelSize: "none" });
      const status = await getModelDownloadStatus(true);
      expect(status).toEqual({ kind: "unsupported" });
      expect(hasModelInCache).not.toHaveBeenCalled();
    });

    it("reports downloaded when web-llm says the model is cached", async () => {
      hasModelInCache.mockResolvedValue(true);
      const status = await getModelDownloadStatus(true);
      expect(status).toEqual({
        kind: "downloaded",
        modelId: MODEL_3B,
        sizeLabel: "~1.8 GB",
      });
      expect(hasModelInCache).toHaveBeenCalledWith(MODEL_3B);
    });

    it("reports not-downloaded when web-llm says the model is missing", async () => {
      hasModelInCache.mockResolvedValue(false);
      const status = await getModelDownloadStatus(true);
      expect(status).toEqual({
        kind: "not-downloaded",
        modelId: MODEL_3B,
        sizeLabel: "~1.8 GB",
      });
    });

    it("uses the ~700 MB label for the 1B model", async () => {
      setCapability({ available: true, modelSize: "1b" });
      hasModelInCache.mockResolvedValue(true);
      const status = await getModelDownloadStatus(true);
      expect(status).toEqual({
        kind: "downloaded",
        modelId: MODEL_1B,
        sizeLabel: "~700 MB",
      });
    });

    it("falls back to not-downloaded when hasModelInCache throws", async () => {
      hasModelInCache.mockRejectedValue(new Error("ModelNotFoundError"));
      const status = await getModelDownloadStatus(true);
      expect(status).toEqual({
        kind: "not-downloaded",
        modelId: MODEL_3B,
        sizeLabel: "~1.8 GB",
      });
    });

    it("memoizes the result across calls", async () => {
      hasModelInCache.mockResolvedValue(true);
      await getModelDownloadStatus(true);
      await getModelDownloadStatus();
      await getModelDownloadStatus();
      expect(hasModelInCache).toHaveBeenCalledTimes(1);
    });

    it("re-probes when force=true", async () => {
      hasModelInCache.mockResolvedValue(true);
      await getModelDownloadStatus(true);
      await getModelDownloadStatus(true);
      expect(hasModelInCache).toHaveBeenCalledTimes(2);
    });

    it("dedupes concurrent in-flight probes", async () => {
      hasModelInCache.mockResolvedValue(false);
      const [a, b] = await Promise.all([
        getModelDownloadStatus(true),
        getModelDownloadStatus(),
      ]);
      expect(a).toEqual(b);
      expect(hasModelInCache).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearModelFromCache", () => {
    it("calls deleteModelAllInfoInCache with the chosen model id", async () => {
      deleteModelAllInfoInCache.mockResolvedValue();
      await clearModelFromCache();
      expect(deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL_3B);
    });

    it("clears the memoized status so the next read re-probes", async () => {
      hasModelInCache.mockResolvedValue(true);
      const before = await getModelDownloadStatus(true);
      expect(before.kind).toBe("downloaded");

      deleteModelAllInfoInCache.mockResolvedValue();
      await clearModelFromCache();

      hasModelInCache.mockResolvedValue(false);
      const after = await getModelDownloadStatus();
      expect(after.kind).toBe("not-downloaded");
      expect(hasModelInCache).toHaveBeenCalledTimes(2);
    });

    it("is a no-op when no model is selectable", async () => {
      setCapability({ available: false, modelSize: "none" });
      await clearModelFromCache();
      expect(deleteModelAllInfoInCache).not.toHaveBeenCalled();
    });

    it("propagates errors from web-llm", async () => {
      deleteModelAllInfoInCache.mockRejectedValue(new Error("boom"));
      await expect(clearModelFromCache()).rejects.toThrow("boom");
    });
  });
});
