/**
 * Getting readable text out of whatever the user picked.
 *
 * A PDF carries its text; a photo has to be read out of pixels. The
 * extraction pipeline downstream does not care which, so this is the one
 * place that knows the difference -- and the one place that says how
 * much to trust what comes back.
 */

export class DocumentTextError extends Error {}

export type DocumentSource = "pdf" | "image";

export interface DocumentText {
  text: string;
  source: DocumentSource;
  /** Pages for a PDF; always 1 for an image. */
  pages: number;
}

/** True for anything the picker should accept. */
export function isReadableFile(file: File): boolean {
  return file.type === "application/pdf" || file.type.startsWith("image/");
}

export async function extractDocumentText(file: File): Promise<DocumentText> {
  if (file.type.startsWith("image/")) {
    const { extractImageText } = await import("./image-text");
    return extractImageText(file);
  }
  const { extractPdfText } = await import("./pdf-text");
  return extractPdfText(file);
}
