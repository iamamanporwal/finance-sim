export type Currency = "USD" | "INR";

export function money(v: number | null | undefined, currency: Currency = "USD"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  const abs = Math.abs(v);
  const compact = abs >= 100_000;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : abs < 100 ? 2 : 0,
  }).format(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return `${(v * 100).toFixed(digits)}%`;
}

export function count(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(v) < 100 ? 1 : 0 }).format(v);
}

export function months(v: number | null | undefined): string {
  if (v === null || v === undefined) return "not burning";
  if (!Number.isFinite(v)) return "n/a";
  return `${v.toFixed(1)} months`;
}

export function byUnit(v: number, unit: string, _currency?: Currency): string {
  if (unit === "percent") return pct(v, 2).replace(/\.00%$/, "%");
  const [head, per] = unit.split("/");
  if (head === "USD" || head === "INR") return money(v, head as Currency) + (per ? `/${per.replace(/s$/, "")}` : "");
  if (!unit || unit === "number") return count(v);
  return `${count(v)} ${unit}`;
}
