#!/usr/bin/env node
/**
 * Vercel linked at repo root runs `next build` under frontend/, but the Next.js
 * builder expects `.next/`, `node_modules/`, and `public/` at the project root.
 */
import { cpSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "frontend");

function replaceWithSymlink(src, dest, label) {
  if (!existsSync(src)) {
    console.error(`sync-next-output: missing ${label} at ${src}`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  symlinkSync(src, dest, "dir");
  console.log(`sync-next-output: linked ${label} → ${dest}`);
}

const nextSrc = join(frontend, ".next");
const nextDest = join(root, ".next");

if (!existsSync(join(nextSrc, "routes-manifest.json"))) {
  console.error("sync-next-output: missing frontend/.next/routes-manifest.json — build failed?");
  process.exit(1);
}

rmSync(nextDest, { recursive: true, force: true });
cpSync(nextSrc, nextDest, { recursive: true });
console.log("sync-next-output: copied frontend/.next → .next");

replaceWithSymlink(join(frontend, "node_modules"), join(root, "node_modules"), "node_modules");
replaceWithSymlink(join(frontend, "public"), join(root, "public"), "public");
