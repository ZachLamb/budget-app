/**
 * Pulling the text layer out of a PDF, in the browser.
 *
 * The whole point of doing this here rather than on the server is that a
 * tax return never leaves the machine: the bytes are read, the text is
 * handed to an on-device model, and neither is uploaded or stored.
 *
 * pdf.js is loaded on demand so its ~1 MB does not ride along in the main
 * bundle for everyone who never opens a document. It is the only module
 * that knows about the library, so swapping or dropping it is a one-file
 * change.
 */

/** Refuse a file large enough to lock up the tab before we ever read it. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Beyond this, the file is not a tax return and will not fit a prompt. */
export const MAX_PAGES = 20;

export class PdfTextError extends Error {}

export interface PdfText {
  text: string;
  pages: number;
}

/**
 * A PDF made by scanning paper has no text layer -- pdf.js returns almost
 * nothing and the model would be reading an empty page. Saying so beats
 * an extraction that finds nothing and looks like a model failure.
 */
const MIN_USEFUL_CHARS = 40;

export async function extractPdfText(file: File): Promise<PdfText> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfTextError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Tax returns are usually well under ${MAX_PDF_BYTES / 1024 / 1024} MB — check you picked the right file.`,
    );
  }

  const pdfjs = await import("pdfjs-dist");
  // Without a worker pdf.js parses on the main thread and freezes the tab.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const bytes = new Uint8Array(await file.arrayBuffer());

  // A tax return has no reason to fetch anything off the network, and
  // nothing here renders, so fonts and prefetching are dead weight.
  const task = pdfjs.getDocument({
    data: bytes,
    disableAutoFetch: true,
    disableFontFace: true,
    // Served from our own origin (see scripts/copy-pdf-assets.mjs). pdf.js
    // needs metrics for the 14 base fonts to turn glyphs into text, and
    // fetching them from a CDN would put a network call in the middle of a
    // flow whose whole promise is that nothing leaves the machine.
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });

  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    throw new PdfTextError(
      e instanceof Error && /password/i.test(e.message)
        ? "That PDF is password-protected. Open it, save an unlocked copy, and try again."
        : "That file could not be read as a PDF.",
    );
  }

  try {
    const pageCount = Math.min(doc.numPages, MAX_PAGES);
    const pages: string[] = [];
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push(line);
      page.cleanup();
    }

    const text = pages.join("\n").replace(/[ \t]+/g, " ").trim();
    if (text.length < MIN_USEFUL_CHARS) {
      throw new PdfTextError(
        "There is no text in that PDF — it looks like a scan or a photo. Reading those needs a different tool; for now, type the four figures in below.",
      );
    }
    return { text, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
