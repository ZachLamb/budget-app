#!/usr/bin/env node
/**
 * Vercel project "clarity" uses Root Directory = `.` on the dashboard. Builds run
 * under frontend/ but the Next.js platform step expects .next and node_modules
 * at the repository root. Hard-copy trees (no symlinks — Vercel's tracer breaks).
 *
 * Long-term: set Vercel → Settings → Root Directory = `frontend` and delete this.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "frontend");

function copyTree(src, dest, label) {
  if (!existsSync(src)) {
    console.error(`sync-next-output: missing ${label} at ${src}`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`sync-next-output: copied ${label}`);
}

if (!existsSync(join(frontend, ".next", "routes-manifest.json"))) {
  console.error("sync-next-output: missing frontend/.next/routes-manifest.json");
  process.exit(1);
}

copyTree(join(frontend, ".next"), join(root, ".next"), ".next");
copyTree(join(frontend, "node_modules"), join(root, "node_modules"), "node_modules");
copyTree(join(frontend, "public"), join(root, "public"), "public");
