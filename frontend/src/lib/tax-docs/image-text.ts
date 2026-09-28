/**
 * Reading text out of a photo or scan.
 *
 * Tesseract runs in a worker in this browser: the image is never
 * uploaded. What IS fetched, once, is the OCR engine and its English
 * language data -- about 5 MB from a CDN, cached afterwards. That is a
 * model download and says nothing about the document, the same bargain
 * the app already makes for its fallback language model, but it does
 * mean the first scan needs a connection.
 *
 * OCR errors are different in kind from the ones a text PDF produces.
 * A PDF misread is a model misunderstanding a label; an OCR misread is a
 * 3 that came out as an 8, which propagates into a figure that looks
 * entirely ordinary. The per-figure quote check cannot catch that -- the
 * digit is genuinely in the text it was given. Only the cross-checks in
 * `paystub-extract` and `w2-extract` can, which is why those matter more
 * on this path than on the PDF one.
 */
import { DocumentTextError, type DocumentText } from "./document-text";

/** A photo of a payslip is well under this; a raw camera dump is not. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Below this, OCR found so little that the picture is the problem. */
const MIN_USEFUL_CHARS = 40;

export async function extractImageText(file: File): Promise<DocumentText> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new DocumentTextError(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Photos of a payslip are usually a fraction of that — try a smaller one, or a PDF if you have it.`,
    );
  }

  const { createWorker } = await import("tesseract.js");

  let worker;
  try {
    worker = await createWorker("eng");
  } catch {
    throw new DocumentTextError(
      "The text reader could not start. It downloads once on first use, so this usually means there is no connection.",
    );
  }

  try {
    const { data } = await worker.recognize(file);
    const text = (data.text ?? "").replace(/[ \t]+/g, " ").trim();
    if (text.length < MIN_USEFUL_CHARS) {
      throw new DocumentTextError(
        "Almost no text could be read from that image. A straight-on photo in good light, filling the frame, reads far better than an angled one.",
      );
    }
    return { text, source: "image", pages: 1 };
  } catch (e) {
    if (e instanceof DocumentTextError) throw e;
    throw new DocumentTextError("That image could not be read.");
  } finally {
    await worker.terminate();
  }
}
