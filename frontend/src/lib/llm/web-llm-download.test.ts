import { describe, it, expect } from "vitest";
import { formatWebLlmDownloadError, normalizeInitProgress } from "./web-llm-download";

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
