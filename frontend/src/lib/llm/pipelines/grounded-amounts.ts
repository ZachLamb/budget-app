export function collectAmountsCents(value: unknown): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.add(Math.round(Math.abs(v) * 100));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out;
}

const DOLLAR_RE = /\$\s?([\d,]+(?:\.\d{1,2})?)/g;

export function amountsAreGrounded(answer: string, allowed: Set<number>): boolean {
  for (const m of answer.matchAll(DOLLAR_RE)) {
    const cents = Math.round(parseFloat(m[1].replaceAll(",", "")) * 100);
    if (!allowed.has(cents)) return false;
  }
  return true;
}
