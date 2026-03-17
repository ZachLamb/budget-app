#!/usr/bin/env node
/**
 * Validates that every @/components/ui/<name> import has a corresponding file.
 * Run: node scripts/check-ui-imports.mjs
 * Add to CI / pre-build step to catch missing shadcn components early.
 */

import { readdirSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { globSync } from "fs";

const ROOT = new URL("..", import.meta.url).pathname;
const UI_DIR = join(ROOT, "src/components/ui");
const SRC_DIR = join(ROOT, "src");

// All existing UI component filenames (without extension)
const existing = new Set(
  readdirSync(UI_DIR)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => f.replace(/\.(tsx|ts)$/, ""))
);

// Walk all source files and collect ui imports
const importRe = /from ["']@\/components\/ui\/([^"']+)["']/g;
const errors = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(importRe)) {
        const component = m[1];
        if (!existing.has(component)) {
          errors.push(`  ${full.replace(ROOT, "")}: missing ui/${component}`);
        }
      }
    }
  }
}

walk(SRC_DIR);

if (errors.length > 0) {
  console.error("❌ Missing UI components detected:\n");
  errors.forEach((e) => console.error(e));
  console.error(
    `\nCreate the missing files in src/components/ui/ or run: npx shadcn@latest add <component>`
  );
  process.exit(1);
} else {
  console.log(`✅ All UI component imports resolve (${existing.size} components found).`);
}
