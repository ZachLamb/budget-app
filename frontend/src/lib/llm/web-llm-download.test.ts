import { describe, it, expect } from "vitest";
import {
  formatNanoSetupError,
  formatWebLlmDownloadError,
  normalizeInitProgress,
} from "./web-llm-download";

describe("normalizeInitProgress", () => {
  it("converts 0–1 fractions to 0–100", () => {
    expect(normalizeInitProgress(0)).toBe(0);
    expect(normalizeInitProgress(0.45)).toBe(45);
    expect(normalizeInitProgress(1)).toBe(100);
  });

  it("passes through values already in 0–100 range", () => {
    expect(normalizeInitProgress(45)).toBe(45);
    expect(normalizeInitProgress(100)).toBe(100);
  });

  it("clamps out-of-range values", () => {
    expect(normalizeInitProgress(-0.5)).toBe(0);
    expect(normalizeInitProgress(150)).toBe(100);
    expect(normalizeInitProgress(Number.NaN)).toBe(0);
  });
});

describe("formatWebLlmDownloadError", () => {
  it("maps WebGPU failures", () => {
    expect(formatWebLlmDownloadError(new Error("WebGPU not supported"))).toMatch(/WebGPU/i);
  });

  it("maps network failures", () => {
    expect(formatWebLlmDownloadError(new Error("Failed to fetch"))).toMatch(/network|huggingface/i);
  });

  it("falls back to the original message", () => {
    expect(formatWebLlmDownloadError(new Error("Custom engine error"))).toBe("Custom engine error");
  });
});

describe("formatNanoSetupError", () => {
  it("maps network failures to connection/retry guidance without huggingface", () => {
    const msg = formatNanoSetupError("Failed to fetch");
    expect(msg).not.toMatch(/huggingface/i);
    expect(msg).toMatch(/connection|internet|try again|retry/i);
  });

  it("maps quota/storage failures to disk-space guidance without 'lite model'", () => {
    const msg = formatNanoSetupError("QuotaExceededError: storage full");
    expect(msg).not.toMatch(/lite model/i);
    expect(msg).toMatch(/disk space|storage/i);
  });

  it("does not inject web-llm guidance (no WebGPU/huggingface/lite model) for network errors", () => {
    const msg = formatNanoSetupError("Failed to fetch");
    expect(msg).not.toMatch(/webgpu/i);
    expect(msg).not.toMatch(/huggingface/i);
    expect(msg).not.toMatch(/lite model/i);
  });

  it("surfaces a clean fallback for unknown messages", () => {
    expect(formatNanoSetupError("Something odd happened")).toBe("Something odd happened");
  });

  it("provides a generic setup-failed message when empty", () => {
    expect(formatNanoSetupError("")).toMatch(/setup failed|try again/i);
  });
});
