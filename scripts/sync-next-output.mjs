#!/usr/bin/env node
/**
 * Vercel project "clarity" uses Root Directory = `.` on the dashboard. Builds run
 * under frontend/ but the Next.js platform step expects artifacts at the repo
 * root; file tracing reads /vercel/node_modules while the clone is path0.
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

if (!existsSync(join(frontend, ".next", "routes-manifest.json"))) {
  console.error("sync-next-output: missing frontend/.next/routes-manifest.json");
  process.exit(1);
}

copyTree(join(frontend, ".next"), join(repoRoot, ".next"), ".next");
copyTree(join(frontend, "public"), join(repoRoot, "public"), "public");

// Post-build tracing looks under /vercel/node_modules, not only path0/node_modules.
if (process.env.VERCEL === "1" && existsSync("/vercel")) {
  copyTree(
    join(frontend, "node_modules"),
    join("/vercel", "node_modules"),
    "node_modules (/vercel)",
  );
}

copyTree(join(frontend, "node_modules"), join(repoRoot, "node_modules"), "node_modules");
