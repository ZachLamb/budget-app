import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../types";

vi.mock("./steps", () => ({
  generateStructured: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  default: { post: vi.fn() },
}));

import { detectIntent } from "./intent";
import { generateStructured } from "./steps";

function provider(): LLMProvider {
  return {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {
      yield "";
    },
  };
}

describe("detectIntent", () => {
  it("returns structured intent for create_category", async () => {
    vi.mocked(generateStructured).mockResolvedValueOnce({
      action_type: "create_category",
      name: "Fees",
      confirmation_text: "Create category Fees?",
    });
    const intent = await detectIntent(provider(), "put fees in their own category");
    expect(intent).toMatchObject({
      action_type: "create_category",
      data: { name: "Fees" },
      confirmation_text: "Create category Fees?",
    });
  });

  it("returns null for action_type none", async () => {
    vi.mocked(generateStructured).mockResolvedValueOnce({
      action_type: "none",
      confirmation_text: "",
    });
    expect(await detectIntent(provider(), "how much on gas?")).toBeNull();
  });

  it("returns null on parse failure (fail-open)", async () => {
    vi.mocked(generateStructured).mockRejectedValueOnce(new Error("bad json"));
    expect(await detectIntent(provider(), "do something")).toBeNull();
  });
});
