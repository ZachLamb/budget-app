import { describe, expect, it } from "vitest";
import { buildIntentPrompt, buildIntentSystem, INTENT_SCHEMA } from "./intent-prompt";

describe("intent prompt builders", () => {
  it("schema includes none and supported action types", () => {
    const enums = (INTENT_SCHEMA.properties.action_type as { enum: string[] }).enum;
    expect(enums).toContain("none");
    expect(enums).toContain("create_category");
    expect(enums).toContain("bulk_recategorize");
  });

  it("prompt contains the question", () => {
    expect(buildIntentPrompt("create a fees category")).toContain("create a fees category");
  });

  it("system says extract and never invent", () => {
    expect(buildIntentSystem()).toMatch(/extract/i);
    expect(buildIntentSystem()).toMatch(/never invent/i);
  });
});
