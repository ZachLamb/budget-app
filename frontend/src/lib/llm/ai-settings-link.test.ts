import { describe, expect, it } from "vitest";
import { isAiAvailabilityMessage } from "./ai-settings-link";

describe("isAiAvailabilityMessage", () => {
  it("matches on-device AI errors", () => {
    expect(isAiAvailabilityMessage("On-device AI needs Chrome or Edge")).toBe(true);
    expect(isAiAvailabilityMessage("AI is not available for categorization")).toBe(true);
    expect(isAiAvailabilityMessage("AI is not available for FSA review")).toBe(true);
    expect(isAiAvailabilityMessage("Enable AI in Settings and complete on-device setup.")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isAiAvailabilityMessage("Network request failed")).toBe(false);
  });
});
