/**
 * Presentation logic for the self-hosted model server (LM Studio / Ollama).
 * Pure so the connection-state edge cases are unit-tested independently of the UI.
 */
import type { LlmBackendStatus } from "@/lib/api/settings";

export type LocalServerState =
  | { kind: "not-configured" }
  | { kind: "unreachable" }
  | { kind: "connected"; model: string | null };

/** Collapse a backend-status payload into the single state the UI renders. */
export function describeLocalServer(status: LlmBackendStatus | undefined): LocalServerState {
  if (!status || !status.configured) return { kind: "not-configured" };
  if (!status.reachable) return { kind: "unreachable" };
  return { kind: "connected", model: status.active_model };
}

/** The toggle may only be switched ON when a server is actually reachable. */
export function canEnableLocalServer(status: LlmBackendStatus | undefined): boolean {
  return describeLocalServer(status).kind === "connected";
}

/** Short human status line for the Settings row. */
export function localServerStatusLabel(status: LlmBackendStatus | undefined): string {
  const state = describeLocalServer(status);
  switch (state.kind) {
    case "not-configured":
      return "No local server configured";
    case "unreachable":
      return "Configured, but not reachable";
    case "connected":
      return state.model ? `Connected — ${state.model}` : "Connected";
  }
}
