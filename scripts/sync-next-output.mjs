#!/usr/bin/env node
/**
 * Vercel project "clarity" uses Root Directory = `.` on the dashboard. Builds run
 * under frontend/ but the Next.js platform step expects artifacts at the repo root
 * and node_modules at /vercel/node_modules (not only /vercel/path0).
 *
 * Long-term: set Vercel → Settings → Root Directory = `frontend` and delete this.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repoRoot, "frontend");

function copyTree(src, dest, label) {
  if (!existsSync(src)) {
    console.error(`sync-next-output: missing ${label} at ${src}`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`sync-next-output: copied ${label} → ${dest}`);
}

function syncPair(src, rel, label) {
  const targets = [repoRoot];
  // Post-build file tracing reads /vercel/node_modules while the clone lives under path0.
  if (process.env.VERCEL === "1" && existsSync("/vercel")) {
    targets.push("/vercel");
  }
  for (const base of targets) {
    copyTree(src, join(base, rel), `${label} (${base})`);
  }
}

if (!existsSync(join(frontend, ".next", "routes-manifest.json"))) {
  console.error("sync-next-output: missing frontend/.next/routes-manifest.json");
  process.exit(1);
}

syncPair(join(frontend, ".next"), ".next", ".next");
syncPair(join(frontend, "node_modules"), "node_modules", "node_modules");
syncPair(join(frontend, "public"), "public", "public");
