/**
 * Hosting health — surface for the Settings card.
 *
 * Backend gates the route on auth, and fails soft when FLY_API_TOKEN
 * isn't configured (the card renders a placeholder in that case).
 */

import api from "./client";

export interface HostingMachine {
  id: string;
  state: string;
  region: string;
  cpu_kind: string;
  cpus: number;
  memory_mb: number;
}

export interface HostingVolume {
  id: string;
  name: string;
  size_gb: number;
  region: string;
  attached_machine_id: string | null;
}

export interface HostingApp {
  app_name: string;
  available: boolean;
  error: string | null;
  machines: HostingMachine[];
  volumes: HostingVolume[];
}

export interface HostingHealth {
  available: boolean;
  apps: HostingApp[];
  /** Human-readable drift warnings vs the free-tier blueprint. Empty = healthy. */
  drift: string[];
  /** ISO-8601 timestamp of the last successful fetch. */
  last_checked: string;
  /** Expected values from the blueprint, useful for tooltips. */
  blueprint: Record<string, number>;
}

export const hostingApi = {
  /** Server-side cached for 5 min; pass `force=true` to refresh. */
  getHealth: (force = false) =>
    api
      .get<HostingHealth>(`/hosting/health${force ? "?refresh=true" : ""}`)
      .then((r) => r.data),
};
