/**
 * Client-side PII pattern scanner for prompts that are about to leave the device
 * (Tier 4 / cloud). Conservative by design — false positives annoy users and
 * train them to ignore the warning. We only flag patterns that look unambiguous.
 *
 * This is a UX warning, NOT a security boundary. The server-side log redactor
 * is the actual data-handling control; this exists to give the user a chance
 * to abort before their SSN or someone else's email is interpolated into a
 * prompt that crosses the network.
 */

export type PIIFlag = "ssn" | "credit_card" | "email" | "phone";

export interface PIIScan {
  flags: PIIFlag[];
  /**
   * Internal — first 5 occurrences per flag. NOT shown to the user verbatim
   * (that would defeat the purpose of warning them). Useful for tests/debug.
   */
  matchedText: Record<PIIFlag, string[]>;
}

const MAX_MATCHES_PER_FLAG = 5;

// US SSN with required separator (- or whitespace). Plain 9-digit strings are
// too easily confused with order numbers / account refs / phone numbers
// without area-code parens, so we require the separators.
const SSN_RE = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g;

// Email — standard-ish RFC-lite. Local part allows letters, digits, dot, plus,
// dash, underscore. Domain requires a 2+ letter TLD.
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g;

// US phone with separators. We require the separator between every segment so
// that bare 10-digit strings (which could be order IDs) don't trigger.
const PHONE_RE = /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

// Credit-card-ish: 13–19 digit groups with optional space/dash separators
// between every 4 digits. We then validate the digit-only length AND require
// a Luhn check to avoid matching things like "1234-5678-9012-3456" sequential
// dummies in copy or partial UUIDs collapsed into runs of digits.
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

function pushUnique(arr: string[], val: string): void {
  if (arr.length >= MAX_MATCHES_PER_FLAG) return;
  if (arr.includes(val)) return;
  arr.push(val);
}

/**
 * Scan free-text for PII-shaped substrings. Conservative: prefers false
 * negatives over false positives.
 */
export function scanPrompt(text: string): PIIScan {
  const matchedText: Record<PIIFlag, string[]> = {
    ssn: [],
    credit_card: [],
    email: [],
    phone: [],
  };

  if (typeof text !== "string" || text.length === 0) {
    return { flags: [], matchedText };
  }

  // Email first — emails can contain "@gmail.com" which is unambiguous and
  // must not be eaten by phone/card heuristics.
  for (const m of text.matchAll(EMAIL_RE)) {
    pushUnique(matchedText.email, m[0]);
  }

  for (const m of text.matchAll(SSN_RE)) {
    const raw = m[0];
    // Reject obvious non-SSNs that match the SSN shape:
    //   - any group all zeros (000-XX-XXXX, XXX-00-XXXX, XXX-XX-0000) — never issued
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 9) continue;
    if (digits.startsWith("000")) continue;
    if (digits.slice(3, 5) === "00") continue;
    if (digits.slice(5) === "0000") continue;
    pushUnique(matchedText.ssn, raw);
  }

  for (const m of text.matchAll(PHONE_RE)) {
    pushUnique(matchedText.phone, m[0]);
  }

  for (const m of text.matchAll(CARD_RE)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (!luhnCheck(digits)) continue;
    pushUnique(matchedText.credit_card, raw);
  }

  const flags: PIIFlag[] = [];
  if (matchedText.ssn.length > 0) flags.push("ssn");
  if (matchedText.credit_card.length > 0) flags.push("credit_card");
  if (matchedText.email.length > 0) flags.push("email");
  if (matchedText.phone.length > 0) flags.push("phone");

  return { flags, matchedText };
}
