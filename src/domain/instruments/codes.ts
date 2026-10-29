/** QA Tech instrument IDs ("E-TRH0533"): pure helpers shared by screens and imports. */

/**
 * Next IDs in a series: "E-TRH0533" → E-TRH0534, E-TRH0535… keeping the
 * zero padding. Used when a batch of new loggers arrives.
 */
export function nextCodes(lastCode: string, count: number): string[] {
  const match = /^(.*?)(\d+)$/.exec(lastCode.trim());
  if (!match) return [];
  const [, prefix = "", digits = "0"] = match;
  const start = Number(digits);
  return Array.from(
    { length: count },
    (_, i) => `${prefix}${String(start + i + 1).padStart(digits.length, "0")}`,
  );
}

/** The highest of `codes` that is `prefix` followed by digits, or null. */
export function lastCodeIn(codes: string[], prefix: string): string | null {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`, "i");
  let best: { code: string; n: number; len: number } | null = null;
  for (const code of codes) {
    const m = pattern.exec(code);
    if (!m) continue;
    const n = Number(m[1]);
    if (!best || n > best.n || (n === best.n && code.length > best.len)) {
      best = { code, n, len: code.length };
    }
  }
  return best?.code ?? null;
}

/** First IDs for a prefix that has none yet: "E-TRH" → E-TRH0001… */
export function firstCodes(prefix: string, count: number): string[] {
  return nextCodes(`${prefix}0000`, count);
}
