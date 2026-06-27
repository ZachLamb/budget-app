import { describe, expect, it } from "vitest";
import { withNanoSlot } from "./session-pool";

describe("withNanoSlot", () => {
  it("serializes work when the cap is 1", async () => {
    const order: string[] = [];
    const a = withNanoSlot(async () => {
      order.push("a-start");
      await Promise.resolve();
      order.push("a-end");
    });
    const b = withNanoSlot(async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("keeps serializing after a task throws", async () => {
    const order: string[] = [];
    const a = withNanoSlot(async () => {
      order.push("a");
      throw new Error("boom");
    }).catch(() => {});
    const b = withNanoSlot(async () => {
      order.push("b");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("returns the resolved value of fn", async () => {
    await expect(withNanoSlot(async () => 42)).resolves.toBe(42);
  });
});
