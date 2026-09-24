/**
 * Grounding check for AI explanations: every number the AI writes must match a
 * number the simulation engine produced. The AI may round ("$1.8M" for
 * 1,812,400) but may not calculate or invent values.
 */

export interface NumberMention {
  text: string;
  /** Candidate numeric readings (e.g. "39%" → 0.39 and 39). */
  values: number[];
}

// $1.8M · 4,820 · 39% · 0.5 · −$12K · 1.2B
const NUMBER = /([−-]?)(\$|₹)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(K|M|B|k|m|bn|%|x|×)?(?![\w])/g;
const DATE = /\b\d{4}-\d{2}(?:-\d{2})?\b/g;

export function extractNumbers(text: string): NumberMention[] {
  const cleaned = text.replace(DATE, " ");
  const out: NumberMention[] = [];
  for (const m of cleaned.matchAll(NUMBER)) {
    const [whole, minus, currency, digits, suffix] = m;
    let v = Number(digits!.replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    const scale = suffix === "K" || suffix === "k" ? 1e3 : suffix === "M" || suffix === "m" ? 1e6 : suffix === "B" || suffix === "bn" ? 1e9 : 1;
    v *= scale;
    if (minus) v = -v;
    const values = suffix === "%" ? [v / 100, v] : [v];
    // Small bare integers are usually counts in prose ("3 assumptions", "step 2"), not results.
    const bareSmallInt = !currency && !suffix && Number.isInteger(v) && Math.abs(v) <= 12;
    if (bareSmallInt) continue;
    out.push({ text: whole!.trim(), values });
  }
  return out;
}

function matches(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  const abs = Math.abs(b);
  // Rounded quotes: 1.5% relative difference; whole-unit rounding for values 1–100; 0.5 percentage points for fractions.
  const tolerance = abs < 1 ? 0.0051 : abs < 100 ? 0.51 : 0;
  return diff <= Math.max(abs * 0.015, tolerance);
}

/** Numbers in `text` that do not correspond to any allowed engine value. */
export function ungroundedNumbers(text: string, allowed: readonly number[]): string[] {
  const pool = allowed.filter(Number.isFinite).flatMap((v) => [v, Math.abs(v), v * 100]);
  return extractNumbers(text)
    .filter((m) => !m.values.some((v) => pool.some((a) => matches(Math.abs(v), Math.abs(a)))))
    .map((m) => m.text);
}
