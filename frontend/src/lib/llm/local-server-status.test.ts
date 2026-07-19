import { describe, it, expect } from "vitest";
import {
  describeLocalServer,
  canEnableLocalServer,
  localServerStatusLabel,
} from "./local-server-status";
import type { LlmBackendStatus } from "@/lib/api/settings";

const status = (o: Partial<LlmBackendStatus>): LlmBackendStatus => ({
  configured: false,
  reachable: false,
  active_model: null,
  models: [],
  ...o,
});

describe("describeLocalServer", () => {
  it("undefined or not configured → not-configured", () => {
    expect(describeLocalServer(undefined)).toEqual({ kind: "not-configured" });
    expect(describeLocalServer(status({ configured: false }))).toEqual({ kind: "not-configured" });
  });

  it("configured but not reachable → unreachable", () => {
    expect(describeLocalServer(status({ configured: true, reachable: false }))).toEqual({
      kind: "unreachable",
    });
  });

  it("reachable → connected with model", () => {
    expect(
      describeLocalServer(status({ configured: true, reachable: true, active_model: "gemma" })),
    ).toEqual({ kind: "connected", model: "gemma" });
  });
});

describe("canEnableLocalServer", () => {
  it("only true when connected", () => {
    expect(canEnableLocalServer(undefined)).toBe(false);
    expect(canEnableLocalServer(status({ configured: true, reachable: false }))).toBe(false);
    expect(canEnableLocalServer(status({ configured: true, reachable: true }))).toBe(true);
  });
});

describe("localServerStatusLabel", () => {
  it("labels each state", () => {
    expect(localServerStatusLabel(undefined)).toBe("No local server configured");
    expect(localServerStatusLabel(status({ configured: true, reachable: false }))).toBe(
      "Configured, but not reachable",
    );
    expect(
      localServerStatusLabel(status({ configured: true, reachable: true, active_model: "gemma-3" })),
    ).toBe("Connected — gemma-3");
    expect(
      localServerStatusLabel(status({ configured: true, reachable: true, active_model: null })),
    ).toBe("Connected");
  });
});
