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
  is_local: false,
  ...o,
});

const connectedLocal = status({ configured: true, reachable: true, is_local: true, active_model: "gemma" });
const connectedRemote = status({ configured: true, reachable: true, is_local: false, active_model: "gemma" });

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

  it("reachable → connected with model and locality", () => {
    expect(describeLocalServer(connectedLocal)).toEqual({ kind: "connected", model: "gemma", isLocal: true });
    expect(describeLocalServer(connectedRemote)).toEqual({ kind: "connected", model: "gemma", isLocal: false });
  });
});

describe("canEnableLocalServer", () => {
  it("only true when connected AND local", () => {
    expect(canEnableLocalServer(undefined)).toBe(false);
    expect(canEnableLocalServer(status({ configured: true, reachable: false }))).toBe(false);
    expect(canEnableLocalServer(connectedRemote)).toBe(false);
    expect(canEnableLocalServer(connectedLocal)).toBe(true);
  });
});

describe("localServerStatusLabel", () => {
  it("labels each state", () => {
    expect(localServerStatusLabel(undefined)).toBe("No local server configured");
    expect(localServerStatusLabel(status({ configured: true, reachable: false }))).toBe(
      "Configured, but not reachable",
    );
    expect(localServerStatusLabel(connectedLocal)).toBe("Connected — gemma");
    expect(localServerStatusLabel(connectedRemote)).toBe("Connected (remote) — gemma");
    expect(
      localServerStatusLabel(status({ configured: true, reachable: true, is_local: true, active_model: null })),
    ).toBe("Connected");
  });
});
