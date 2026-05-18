#!/usr/bin/env node
/**
 * Used when Vercel Root Directory is `.` (Git deploys). Copies frontend build
 * artifacts to the repo root and links /vercel/node_modules for file tracing.
 * Set Root Directory to frontend/ in Vercel settings to remove this script.
 */
import { cpSync, existsSync, rmSync, symlinkSync } from "node:fs";
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
  console.log(`sync-next-output: ${label} → ${dest}`);
}

if (!existsSync(join(frontend, ".next", "routes-manifest.json"))) {
  console.error("sync-next-output: missing frontend/.next/routes-manifest.json");
  process.exit(1);
}

copyTree(join(frontend, ".next"), join(repoRoot, ".next"), ".next");
copyTree(join(frontend, "public"), join(repoRoot, "public"), "public");
copyTree(join(frontend, "node_modules"), join(repoRoot, "node_modules"), "node_modules");

if (process.env.VERCEL === "1" && existsSync("/vercel")) {
  const link = "/vercel/node_modules";
  rmSync(link, { recursive: true, force: true });
  symlinkSync(join(repoRoot, "node_modules"), link, "dir");
  console.log(`sync-next-output: symlink ${link} → ${join(repoRoot, "node_modules")}`);
}
