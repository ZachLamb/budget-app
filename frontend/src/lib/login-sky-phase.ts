/**
 * Local-time buckets for login backdrop mood (data-login-sky):
 * - night: 22:00–04:59 (wraps midnight)
 * - dawn:  05:00–07:59
 * - day:   08:00–16:59
 * - dusk:  17:00–21:59
 *
 * `mode: "theme"` maps light → day and dark → night (no clock), for testing or forced palettes.
 */
export type SkyPhase = "dawn" | "day" | "dusk" | "night";

export type LoginSkyPhaseOptions = {
  mode?: "clock" | "theme";
};

export function getLoginSkyPhase(
  date: Date,
  theme: "light" | "dark",
  options?: LoginSkyPhaseOptions,
): SkyPhase {
  const mode = options?.mode ?? "clock";
  if (mode === "theme") {
    return theme === "dark" ? "night" : "day";
  }

  const h = date.getHours();
  if (h >= 22 || h < 5) return "night";
  if (h < 8) return "dawn";
  if (h < 17) return "day";
  return "dusk";
}
