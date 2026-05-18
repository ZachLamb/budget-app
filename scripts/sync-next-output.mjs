#!/usr/bin/env node
/**
 * Vercel linked at repo root runs `next build` under frontend/, but the Next.js
 * builder expects `.next/` at the project root. Mirror the build output up.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "frontend", ".next");
const dest = join(root, ".next");

if (!existsSync(join(src, "routes-manifest.json"))) {
  console.error("sync-next-output: missing frontend/.next/routes-manifest.json — build failed?");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("sync-next-output: copied frontend/.next → .next");
