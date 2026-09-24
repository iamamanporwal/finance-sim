/**
 * Display formatting. Never renders NaN, Infinity or undefined: anything
 * non-finite becomes an em dash, and null metrics get an explicit label.
 */
import { getMetricDefinition, type CustomMetric } from "@fin/model-schema";

export type Currency = "USD" | "INR";

const DASH = "—";
const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function formatCurrency(v: number | null | undefined, currency: Currency = "USD", opts: { compact?: boolean } = {}): string {
  if (!ok(v)) return DASH;
  const compact = opts.compact ?? Math.abs(v) >= 100_000;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : Math.abs(v) < 100 ? 2 : 0,
    minimumFractionDigits: 0,
  }).format(v);
}

export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (!ok(fraction)) return DASH;
  return `${(fraction * 100).toFixed(digits).replace(/\.0+$/, "")}%`;
}

export function formatCount(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (!ok(v)) return DASH;
  if (opts.compact && Math.abs(v) >= 100_000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : Math.abs(v) < 1000 ? 1 : 0 }).format(v);
}

export function formatMonths(v: number | null | undefined, nullLabel = "Not burning"): string {
  if (v === null || v === undefined) return nullLabel;
  if (!ok(v)) return DASH;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} mo`;
}

export function signed(text: string, v: number): string {
  return v > 0 ? `+${text}` : text;
}

/** Formats a value according to a parameter/unit string. */
export function formatByUnit(v: number | null | undefined, unit: string | undefined, currency: Currency = "USD"): string {
  if (!ok(v)) return DASH;
  const u = (unit ?? "").split("/")[0];
  if (unit === "percent") return formatPercent(v, 2);
  if (u === "USD" || u === "INR") return formatCurrency(v, u as Currency) + (unit?.includes("/") ? `/${unit.split("/")[1]}` : "");
  if (u === "months" || u === "years") return `${formatCount(v)} ${u}`;
  if (!unit || unit === "number") return formatCount(v);
  return `${formatCount(v)} ${unit}`;
}

export type ValueKind = "currency" | "percent" | "count" | "months" | "number";

/** Formats a value by kind (the unit vocabulary shared by metrics and "Why?" explanations). */
export function formatKind(v: number | null | undefined, kind: ValueKind, currency: Currency = "USD"): string {
  switch (kind) {
    case "currency":
      return formatCurrency(v, currency);
    case "percent":
      return formatPercent(v);
    case "months":
      return formatMonths(v, "—");
    case "count":
      return formatCount(v, { compact: true });
    default:
      return formatCount(v);
  }
}

/** Metric-key-aware formatting for dashboards and timelines (built-in and custom metrics). */
export function formatMetric(key: string, v: number | null | undefined, currency: Currency = "USD", customMetrics?: readonly CustomMetric[]): string {
  if (key === "runwayMonths") return formatMonths(v);
  const def = getMetricDefinition(key, customMetrics);
  return formatKind(v, (def?.unit as ValueKind | undefined) ?? "currency", currency);
}
