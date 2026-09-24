export interface Statistics {
  count: number;
  mean: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** Percentile with linear interpolation between closest ranks (the common "type 7" definition). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

/** Returns null when there are no values (never NaN). */
export function describe(values: readonly number[]): Statistics | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  // Kahan summation keeps the mean accurate for large run counts.
  let sum = 0;
  let c = 0;
  for (const v of sorted) {
    const y = v - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export function histogram(values: readonly number[], bins = 30): HistogramBin[] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return [{ from: min, to: max, count: finite.length }];
  const width = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of finite) out[Math.min(bins - 1, Math.floor((v - min) / width))]!.count++;
  return out;
}

export function fraction(flags: readonly boolean[]): number {
  return flags.length === 0 ? 0 : flags.filter(Boolean).length / flags.length;
}
