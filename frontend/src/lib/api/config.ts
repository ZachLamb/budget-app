/**
 * Server-side runtime config. The backend is the source of truth for
 * things like `demo_mode` and which auth methods are enabled — the
 * build-time `NEXT_PUBLIC_*` env vars can silently drift (e.g. the UI
 * was built with DEMO_MODE=false, then backend was flipped to demo).
 *
 * Use the {@link useAppConfig} hook (see `lib/hooks.ts`) for the typical
 * read path. The raw fetcher is exported so non-hook callers (e.g.
 * server components, tests) can use it directly.
 */
import api from "./client";

export interface AuthMethods {
  password: boolean;
  passkey: boolean;
  google: boolean;
}

export interface AppConfig {
  demo_mode: boolean;
  auth_methods: AuthMethods;
}

export const configApi = {
  get: async (): Promise<AppConfig> => {
    const { data } = await api.get<AppConfig>("/api/config");
    return data;
  },
};
