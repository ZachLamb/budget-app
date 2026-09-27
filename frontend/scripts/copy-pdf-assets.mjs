/**
 * Copy pdf.js's standard font data into public/ so PDFs can be read offline.
 *
 * pdf.js needs metrics for the 14 base fonts (Courier, Helvetica, Times) to
 * turn glyphs into text. Without them it refuses the document with
 * "Ensure that the `standardFontDataUrl` API parameter is provided".
 *
 * These are served from our own origin on purpose: the point of reading tax
 * documents in the browser is that nothing about the process reaches the
 * network, and that has to include the fonts.
 *
 * Copied rather than committed — 800 KB of binaries that npm already ships.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const dest = join(process.cwd(), "public", "pdfjs", "standard_fonts");

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(join(pdfjsRoot, "standard_fonts"), dest, { recursive: true });

console.log(`pdf.js standard fonts → ${dest}`);
