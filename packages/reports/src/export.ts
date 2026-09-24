import { getMetricDefinition, metricDefinitionsFor, ModelSchema, SCHEMA_VERSION, validateModel, type Model, type SimulationResult, type ValidationIssue } from "@fin/model-schema";
import type { MonteCarloResult } from "@fin/monte-carlo";
import type { ScenarioComparisonRow } from "@fin/simulation-engine";
import type { Report } from "@fin/model-schema";
import { reportToMarkdown } from "./report";

/**
 * Exports. Every file carries raw engine values (not display strings) so it can
 * be re-analysed, and CSV text cells are neutralised against spreadsheet
 * formula injection.
 */

export type Cell = string | number | boolean | null | undefined;

/** Spreadsheet apps execute cells starting with these characters as formulas. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  // Text (never numbers) that looks like a formula is prefixed with ' so it stays text.
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const EXPORT_FORMAT = "finsim-model";

export function modelJson(model: Model, exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, model }, null, 2);
}

/** Parses an exported model (or a bare model object) and validates it fully. */
export function importModelJson(text: string): { model: Model | null; issues: ValidationIssue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { model: null, issues: [{ severity: "error", code: "invalid-json", message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const candidate = raw && typeof raw === "object" && "model" in raw && (raw as { format?: unknown }).format === EXPORT_FORMAT ? (raw as { model: unknown }).model : raw;
  const v = validateModel(candidate);
  if (!v.model) return { model: null, issues: v.issues };
  return { model: ModelSchema.parse(v.model), issues: v.issues };
}

export function assumptionsCsv(model: Model): string {
  const usedBy = new Map<string, string[]>();
  for (const n of model.nodes) for (const [slot, pid] of Object.entries(n.parameters)) usedBy.set(pid, [...(usedBy.get(pid) ?? []), `${n.label}.${slot}`]);
  return toCsv([
    ["id", "name", "value", "unit", "source", "confidence", "status", "distribution", "min", "max", "used_by", "description"],
    ...model.parameters.map((p) => [p.id, p.name, p.value, p.unit, p.source, p.confidence, p.status, p.distribution ? JSON.stringify(p.distribution) : "", p.min, p.max, (usedBy.get(p.id) ?? []).join("; "), p.description]),
  ]);
}

/** One row per period: statements plus every built-in and custom metric. */
export function timelineCsv(model: Model, result: SimulationResult): string {
  const metrics = metricDefinitionsFor(model).map((d) => d.key);
  const categories = [...new Set(result.timeline.flatMap((p) => Object.keys(p.costs.byCategory)))].sort();
  const header = [
    "period",
    "index",
    "kind",
    "revenue_subscription",
    "revenue_usage",
    "revenue_topups",
    "revenue_other",
    "revenue_total",
    "cogs",
    "opex",
    ...categories.map((c) => `cost_${c}`),
    "gross_profit",
    "operating_profit",
    "customers_opening",
    "customers_new",
    "customers_churned",
    "customers_closing",
    "cash_opening",
    "cash_in",
    "cash_out",
    "cash_closing",
    ...metrics.map((m) => `metric_${m}`),
  ];
  return toCsv([
    header,
    ...result.timeline.map((p) => [
      p.period,
      p.index,
      "forecast",
      p.revenue.subscription,
      p.revenue.usage,
      p.revenue.topups,
      p.revenue.other,
      p.revenue.total,
      p.costs.cogs,
      p.costs.opex,
      ...categories.map((c) => p.costs.byCategory[c] ?? 0),
      p.profit.grossProfit,
      p.profit.operatingProfit,
      p.customers.opening,
      p.customers.new,
      p.customers.churned,
      p.customers.closing,
      p.cash.opening,
      p.cash.inflow,
      p.cash.outflow,
      p.cash.closing,
      ...metrics.map((m) => p.metrics[m] ?? null),
    ]),
  ]);
}

/** Every node's value in every period (the audit trail), long format. */
export function nodeValuesCsv(model: Model, result: SimulationResult): string {
  const labels = new Map(model.nodes.map((n) => [n.id, n.label]));
  const rows: Cell[][] = [["period", "node_id", "node", "output", "value"]];
  for (const p of result.timeline) for (const [id, ports] of Object.entries(p.nodes)) for (const [port, v] of Object.entries(ports)) rows.push([p.period, id, labels.get(id), port, v]);
  return toCsv(rows);
}

export function resultsJson(model: Model, result: SimulationResult, exportedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      format: "finsim-results",
      exportedAt,
      model: { id: model.id, name: model.name, version: model.version },
      runId: result.runId,
      scenarioId: result.scenarioId,
      seed: result.seed,
      settings: result.settings,
      summary: result.summary,
      events: result.events,
      guardrails: result.guardrails.map((g) => ({ ...g, label: model.guardrails.find((x) => x.id === g.guardrailId)?.label })),
      metrics: metricDefinitionsFor(model),
      timeline: result.timeline,
    },
    null,
    2,
  );
}

export function scenariosCsv(model: Model, rows: readonly ScenarioComparisonRow[]): string {
  const params = new Map(model.parameters.map((p) => [p.id, p]));
  const out: Cell[][] = [["section", "scenario", "item", "base_value", "scenario_value"]];
  for (const s of model.scenarios) {
    if (s.overrides.length === 0) out.push(["override", s.name, "(no changes)", null, null]);
    for (const o of s.overrides) out.push(["override", s.name, params.get(o.parameterId)?.name ?? o.parameterId, params.get(o.parameterId)?.value, o.value]);
  }
  const base = rows.find((r) => r.scenarioId === null)?.summary;
  const keys = ["mrr", "arr", "revenue", "customers", "grossMargin", "cash", "burn", "runwayMonths", "breakEvenPeriod", "cashOutPeriod"] as const;
  for (const r of rows) {
    if (!r.summary) {
      out.push(["result", r.name, "error", null, r.error ?? "failed"]);
      continue;
    }
    for (const k of keys) out.push(["result", r.name, getMetricDefinition(k)?.label ?? k, base?.[k] ?? null, r.summary[k]]);
  }
  return toCsv(out);
}

export function monteCarloCsv(mc: MonteCarloResult): string {
  const out: Cell[][] = [["section", "metric", "p10", "p50", "p90", "mean", "min", "max"]];
  for (const [k, s] of Object.entries(mc.metrics)) if (s) out.push(["distribution", k, s.p10, s.p50, s.p90, s.mean, s.min, s.max]);
  for (const [k, v] of Object.entries(mc.probabilities)) out.push(["probability", k, null, v, null, null, null, null]);
  out.push(["run", "runs", mc.runs], ["run", "completed", mc.completed], ["run", "failed", mc.failed], ["run", "seed", mc.seed]);
  for (const p of mc.uncertainParameters) out.push(["uncertain_assumption", p.name, null, p.value, null, null, null, JSON.stringify(p.distribution)]);
  return toCsv(out);
}

export function reportMarkdown(report: Report): string {
  return reportToMarkdown(report);
}

/** Safe file name from a model name. */
export function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "model";
}
