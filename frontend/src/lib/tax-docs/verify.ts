/**
 * Deciding whether a figure a model read off a document is real.
 *
 * Shared by every document type, because the failure is the same one
 * everywhere: asked for a figure that is not there, a model supplies a
 * plausible one rather than nothing. The defence is to make a figure
 * inseparable from the line it was read from, then check that line
 * against the document.
 *
 * Nothing here ever produces a zero. A figure that cannot be confirmed
 * is absent, which is what `missing` means everywhere else in this app.
 */

export interface ExtractedField {
  value: number;
  /** The line of the document this was read from, quoted verbatim. */
  sourceText: string;
}

export interface VerifiedFields<K extends string> {
  fields: Partial<Record<K, ExtractedField>>;
  /** Asked for, not returned with usable evidence. */
  missing: K[];
  /** Why a figure was rejected, in words a person can act on. */
  rejections: string[];
}

/** Upper bound for a plausible figure on a personal tax document. */
const MAX_PLAUSIBLE = 1_000_000_000;

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Digits of a number, so "45,231.00" and "45231" compare equal. */
function digits(text: string): string {
  return text.replace(/[^0-9]/g, "").replace(/0+$/, "") || "0";
}

/**
 * Does `sourceText` actually contain this number?
 *
 * Catches the failure that matters most: a real line lifted from the
 * document with an invented figure attached to it.
 */
export function numberAppearsIn(value: number, sourceText: string): boolean {
  const target = digits(Math.abs(value).toFixed(2));
  for (const match of sourceText.matchAll(/-?[\d,]+(?:\.\d+)?/g)) {
    const candidate = Number(match[0].replace(/,/g, ""));
    if (!Number.isFinite(candidate)) continue;
    if (Math.abs(Math.abs(candidate) - Math.abs(value)) < 0.005) return true;
    if (digits(match[0]) === target) return true;
  }
  return false;
}

interface RawField {
  value?: unknown;
  source_text?: unknown;
}

/**
 * Keep only the figures that arrived with a quote found in the document,
 * containing the number claimed.
 *
 * `labels` supplies the wording for rejections, so the reasons read as
 * "Total tax owed: ..." rather than "total_tax: ...".
 */
export function verifyQuotedFields<K extends string>(
  raw: unknown,
  keys: readonly K[],
  labels: Record<K, string>,
  documentText: string,
): VerifiedFields<K> {
  const haystack = normalize(documentText);
  const fields: Partial<Record<K, ExtractedField>> = {};
  const missing: K[] = [];
  const rejections: string[] = [];

  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const reject = (key: K, why: string) => {
    missing.push(key);
    rejections.push(`${labels[key]}: ${why}`);
  };

  for (const key of keys) {
    const entry = obj[key] as RawField | null | undefined;
    if (entry === null || entry === undefined) {
      missing.push(key);
      continue;
    }
    if (typeof entry !== "object") {
      reject(key, "the model did not say where it read this");
      continue;
    }

    const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
    const sourceText = typeof entry.source_text === "string" ? entry.source_text : "";

    if (!Number.isFinite(value)) {
      missing.push(key);
      continue;
    }
    if (Math.abs(value) > MAX_PLAUSIBLE) {
      reject(key, "the figure read back is too large to be real");
      continue;
    }
    if (!sourceText.trim()) {
      reject(key, "no line from the document was quoted for it");
      continue;
    }
    if (!haystack.includes(normalize(sourceText))) {
      reject(key, "the quoted line is not in this document");
      continue;
    }
    if (!numberAppearsIn(value, sourceText)) {
      reject(key, "the figure does not appear in the line it was quoted from");
      continue;
    }

    fields[key] = { value, sourceText: sourceText.trim() };
  }

  return { fields, missing, rejections };
}

/** Remove an already-verified figure that a cross-check has ruled out. */
export function dropField<K extends string>(
  result: VerifiedFields<K>,
  key: K,
  label: string,
  why: string,
): VerifiedFields<K> {
  if (!result.fields[key]) return result;
  const fields = { ...result.fields };
  delete fields[key];
  return {
    fields,
    missing: [...result.missing, key],
    rejections: [...result.rejections, `${label}: ${why}`],
  };
}
