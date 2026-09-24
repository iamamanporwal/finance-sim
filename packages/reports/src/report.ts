import type { Model, Report, ReportSection, SimulationResult } from "@fin/model-schema";
import type { MonteCarloResult } from "@fin/monte-carlo";
import { explainGuardrail, type ScenarioComparisonRow, type SensitivityResult } from "@fin/simulation-engine";
import { byUnit, count, months, money, pct, type Currency } from "./format";

export interface ReportInput {
  model: Model;
  result: SimulationResult;
  scenarios?: ScenarioComparisonRow[] | null;
  monteCarlo?: MonteCarloResult | null;
  sensitivity?: SensitivityResult | null;
  generatedAt?: string;
  reportId?: string;
}

export interface ReportTable {
  columns: string[];
  rows: string[][];
}

const SOURCE_LABELS: Record<string, string> = { user: "User", ai: "AI suggested", template: "Template", benchmark: "Benchmark", imported: "Imported" };

/**
 * Builds the simulation report. Every number is read from engine output
 * (simulation result, scenario runs, Monte Carlo, sensitivity). Nothing is
 * estimated here, and nothing is written by an AI.
 */
export function generateReport(input: ReportInput): Report {
  const { model, result } = input;
  const cur = model.settings.currency as Currency;
  const $ = (v: number | null | undefined) => money(v, cur);
  const t = result.timeline;
  const first = t[0]!;
  const last = t[t.length - 1]!;
  const hasCash = last.metrics.cash !== null && last.metrics.cash !== undefined;
  const span = `${t.length} ${result.settings.timeStep} periods (${first.period} to ${last.period})`;
  const be = result.summary.breakEvenPeriod;
  const cashOut = result.summary.cashOutPeriod;
  const minCash = hasCash ? t.reduce((m, p) => (p.cash.closing < m.cash.closing ? p : m), first) : null;
  const runways = t.filter((p) => p.metrics.runwayMonths !== null && p.metrics.runwayMonths !== undefined);
  const minRunway = runways.length ? runways.reduce((m, p) => (p.metrics.runwayMonths! < m.metrics.runwayMonths! ? p : m)) : null;
  const peakBurn = t.reduce((m, p) => ((p.metrics.burn ?? 0) > (m.metrics.burn ?? 0) ? p : m), first);
  const sections: ReportSection[] = [];
  const section = (kind: ReportSection["kind"], title: string, body: string, table?: ReportTable) =>
    sections.push({ id: kind, kind, title, body, ...(table ? { data: { table } } : {}) });

  // ── Executive summary ──
  const margins = t.slice(-6).map((p) => p.profit.grossMargin).filter((v): v is number => v !== null);
  const marginStable = margins.length >= 3 && Math.max(...margins) - Math.min(...margins) < 0.02;
  const summary: string[] = [];
  summary.push(`Over ${span}, the model reaches ${$(last.metrics.mrr)} MRR (${$(last.metrics.arr)} ARR) with ${count(last.customers.closing)} customers.`);
  if (last.profit.grossMargin !== null) summary.push(marginStable ? `Gross margin stabilizes around ${pct(last.profit.grossMargin, 0)}.` : `Gross margin ends at ${pct(last.profit.grossMargin)}.`);
  if (hasCash) {
    summary.push(cashOut ? `Cash runs out in ${t[cashOut - 1]!.period}.` : `Cash stays positive throughout, ending at ${$(last.cash.closing)} (lowest ${$(minCash!.cash.closing)} in ${minCash!.period}).`);
  }
  summary.push(be ? `Operating profit turns positive in ${t[be - 1]!.period} (period ${be}).` : `The business does not break even within the forecast.`);
  const topDriver = input.sensitivity?.entries.find((e) => e.impact > 0);
  if (topDriver && input.sensitivity) summary.push(`The largest driver of ${metricName(input.sensitivity.metric)} in ${input.sensitivity.periodLabel} is ${topDriver.name}.`);
  if (input.monteCarlo?.metrics.mrr) {
    const mc = input.monteCarlo;
    summary.push(`Across ${count(mc.completed)} Monte Carlo runs, final MRR ranges from ${$(mc.metrics.mrr!.p10)} (P10) to ${$(mc.metrics.mrr!.p90)} (P90)${mc.probabilities.cashOut !== null ? `, with a ${pct(mc.probabilities.cashOut, 0)} chance of running out of cash` : ""}.`);
  }
  section("executive_summary", "Executive summary", summary.join(" ") + "\n\nThese figures are a simulation, not a prediction: they follow directly from the assumptions listed below.");

  // ── Current state (actuals) vs where the forecast starts ──
  const cs = model.currentState;
  const stageLine = model.metadata.stage ? `Business stage: ${STAGE_LABELS[model.metadata.stage] ?? model.metadata.stage}. ` : "";
  const today: string[] = [];
  if (cs) {
    const parts = [
      cs.mrr !== undefined ? `MRR ${$(cs.mrr)}` : null,
      cs.customers !== undefined ? `${count(cs.customers)} customers` : null,
      cs.cash !== undefined ? `${$(cs.cash)} cash` : null,
      cs.growth !== undefined ? `${pct(cs.growth)} monthly growth` : null,
      cs.churn !== undefined ? `${pct(cs.churn)} monthly churn` : null,
      cs.monthlyExpenses !== undefined ? `${$(cs.monthlyExpenses)} monthly expenses` : null,
    ].filter(Boolean);
    today.push(`As of ${cs.asOf} (actual, ${cs.source === "imported" ? "imported" : "entered by the user"}): ${parts.join(", ") || "no figures entered"}.`);
  }
  const actuals = [...model.actuals].sort((a, b) => a.period.localeCompare(b.period));
  if (actuals.length) today.push(`Actuals are recorded for ${actuals.length} month${actuals.length === 1 ? "" : "s"} (${actuals[0]!.period} to ${actuals[actuals.length - 1]!.period}).`);
  section(
    "current_state",
    "Current state and starting point",
    `${stageLine}${today.join(" ")}${today.length ? "\n\n" : ""}The forecast starts in ${first.period} with ${count(first.customers.opening)} customers${hasCash ? ` and ${$(first.cash.opening)} in cash` : ""}. First-period revenue is ${$(first.revenue.total)} against costs of ${$(first.costs.total)}.${today.length ? "" : "\n\nNo current state or actual data has been entered, so every figure is a forecast."}`,
  );

  // ── Assumptions ──
  const used = new Set(model.nodes.flatMap((n) => Object.values(n.parameters)));
  const params = model.parameters.filter((p) => used.has(p.id));
  const pending = params.filter((p) => p.status === "pending");
  section(
    "assumptions",
    "Key assumptions",
    `The model uses ${params.length} assumptions. ${params.filter((p) => p.source === "ai").length} were suggested by AI${pending.length ? `, of which ${pending.length} have not been reviewed yet` : ""}.`,
    {
      columns: ["Assumption", "Value", "Source", "Confidence", "Uncertainty"],
      rows: params.map((p) => [p.name, byUnit(p.value, p.unit, cur), SOURCE_LABELS[p.source] ?? p.source, p.confidence ?? "—", describeDistribution(p.distribution, p.unit, cur)]),
    },
  );

  // ── Revenue ──
  const milestones = milestonePeriods(t.length);
  const cmgr = first.revenue.total > 0 && t.length > 1 ? (last.revenue.total / first.revenue.total) ** (1 / (t.length - 1)) - 1 : null;
  const mix = (["subscription", "usage", "topups", "other"] as const).filter((k) => last.revenue[k] !== 0).map((k) => `${k} ${$(last.revenue[k])}`);
  section(
    "revenue",
    "Revenue",
    `Revenue grows from ${$(first.revenue.total)} in ${first.period} to ${$(last.revenue.total)} in ${last.period}${cmgr !== null ? `, a compound growth rate of ${pct(cmgr)} per period` : ""}.${mix.length ? ` Final-period mix: ${mix.join(", ")}.` : ""}`,
    { columns: ["Period", "Revenue", "MRR", "ARR"], rows: milestones.map((i) => [t[i - 1]!.period, $(t[i - 1]!.revenue.total), $(t[i - 1]!.metrics.mrr), $(t[i - 1]!.metrics.arr)]) },
  );

  // ── Costs ──
  const categories = Object.entries(last.costs.byCategory).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  section(
    "costs",
    "Costs",
    `Total costs move from ${$(first.costs.total)} to ${$(last.costs.total)} per period. In ${last.period}, COGS is ${$(last.costs.cogs)} and operating expenses are ${$(last.costs.opex)}.${categories.length ? ` The largest category is ${categories[0]![0]} (${$(categories[0]![1])}).` : ""}`,
    { columns: ["Category", `${last.period}`], rows: categories.map(([k, v]) => [k, $(v)]) },
  );

  // ── Profitability ──
  section(
    "profitability",
    "Profitability",
    `Gross profit in ${last.period} is ${$(last.profit.grossProfit)} (${pct(last.profit.grossMargin)} margin) and operating profit is ${$(last.profit.operatingProfit)}. ${be ? `Break-even (operating profit ≥ 0) is reached in ${t[be - 1]!.period}.` : "Break-even is not reached within the forecast."}`,
    { columns: ["Period", "Gross profit", "Gross margin", "Operating profit"], rows: milestones.map((i) => [t[i - 1]!.period, $(t[i - 1]!.profit.grossProfit), pct(t[i - 1]!.profit.grossMargin), $(t[i - 1]!.profit.operatingProfit)]) },
  );

  // ── Cash & runway ──
  section(
    "cash",
    "Cash",
    hasCash
      ? `Cash starts at ${$(first.cash.opening)}, reaches its lowest point of ${$(minCash!.cash.closing)} in ${minCash!.period}, and ends at ${$(last.cash.closing)}.${cashOut ? ` Cash turns negative in ${t[cashOut - 1]!.period}.` : ""}`
      : "The model has no Cash node, so cash is not tracked.",
    hasCash ? { columns: ["Period", "Opening", "In", "Out", "Closing"], rows: milestones.map((i) => { const p = t[i - 1]!; return [p.period, $(p.cash.opening), $(p.cash.inflow), $(p.cash.outflow), $(p.cash.closing)]; }) } : undefined,
  );
  section(
    "runway",
    "Burn and runway",
    !hasCash
      ? "Runway needs a Cash node."
      : (peakBurn.metrics.burn ?? 0) === 0
        ? "The business does not burn cash in any period."
        : `Burn peaks at ${$(peakBurn.metrics.burn)} in ${peakBurn.period}. The shortest runway is ${months(minRunway?.metrics.runwayMonths)} (${minRunway?.period}). In ${last.period}, runway is ${months(last.metrics.runwayMonths)}.`,
  );

  // ── Customers ──
  const totalNew = t.reduce((s, p) => s + p.customers.new, 0);
  const totalChurn = t.reduce((s, p) => s + p.customers.churned, 0);
  section(
    "customers",
    "Customers",
    `Customers grow from ${count(first.customers.opening)} to ${count(last.customers.closing)}: ${count(totalNew)} added and ${count(totalChurn)} lost to churn over the forecast.`,
    { columns: ["Period", "Starting", "New", "Churned", "Ending"], rows: milestones.map((i) => { const p = t[i - 1]!; return [p.period, count(p.customers.opening), count(p.customers.new), count(p.customers.churned), count(p.customers.closing)]; }) },
  );

  // ── Risks ──
  const risks: string[] = [];
  for (const g of result.guardrails) {
    if (g.passed) continue;
    const def = model.guardrails.find((x) => x.id === g.guardrailId);
    if (!def) continue;
    const ex = explainGuardrail(model, result, g.guardrailId, g.violations[0]!);
    risks.push(`- ${def.label}: not met in ${g.violations.length} period(s), first in ${t[g.violations[0]! - 1]!.period}. ${ex.cause}`);
  }
  for (const e of result.events.filter((e) => e.type === "cash_negative" || e.type === "capacity_exceeded")) risks.push(`- ${t[e.period - 1]!.period}: ${e.message}`);
  if (input.monteCarlo?.probabilities.cashOut) risks.push(`- Monte Carlo: ${pct(input.monteCarlo.probabilities.cashOut, 0)} of runs run out of cash.`);
  if (pending.length) risks.push(`- ${pending.length} AI-suggested assumption(s) are not reviewed yet: ${pending.map((p) => p.name).join(", ")}.`);
  const unconfirmed = model.customMetrics.filter((c) => c.status === "needs_confirmation");
  if (unconfirmed.length) risks.push(`- Metric definitions not confirmed: ${unconfirmed.map((c) => c.label).join(", ")}. Guardrails on them may be misleading.`);
  section("risks", "Risks", risks.length ? risks.join("\n") : "No guardrail was breached and no critical event occurred in this run.");

  // ── Sensitivity ──
  const sens = input.sensitivity;
  if (sens) {
    const top = sens.entries.filter((e) => e.impact > 0).slice(0, 6);
    section(
      "sensitivity",
      "What matters most",
      top.length
        ? `Moving each assumption ±${pct(sens.delta, 0)} one at a time, the biggest effects on ${metricName(sens.metric)} in ${sens.periodLabel} (base ${fmtMetric(sens.metric, sens.baseResult, cur)}) come from ${top.slice(0, 3).map((e) => e.name).join(", ")}.`
        : `No assumption changes ${metricName(sens.metric)}.`,
      { columns: ["Assumption", `−${pct(sens.delta, 0)}`, `+${pct(sens.delta, 0)}`, "Swing"], rows: top.map((e) => [e.name, fmtMetric(sens.metric, e.lowResult, cur), fmtMetric(sens.metric, e.highResult, cur), fmtMetric(sens.metric, e.impact, cur)]) },
    );
  } else {
    section("sensitivity", "What matters most", "Sensitivity analysis has not been run for this report.");
  }

  // ── Scenarios ──
  const rows = input.scenarios?.filter((r) => r.summary) ?? [];
  if (rows.length > 1) {
    section("scenarios", "Scenarios", `Comparison of ${rows.length} cases at the end of the forecast.`, {
      columns: ["Metric", ...rows.map((r) => r.name)],
      rows: [
        ["MRR", ...rows.map((r) => $(r.summary!.mrr))],
        ["Gross margin", ...rows.map((r) => pct(r.summary!.grossMargin))],
        ["Cash", ...rows.map((r) => (r.summary!.cash === null ? "—" : $(r.summary!.cash)))],
        ["Shortest runway", ...rows.map((r) => months(r.minRunwayMonths))],
        ["Break-even", ...rows.map((r) => (r.summary!.breakEvenPeriod ? `period ${r.summary!.breakEvenPeriod}` : "not reached"))],
      ],
    });
  } else {
    section("scenarios", "Scenarios", "Only the base case was simulated.");
  }

  // ── Monte Carlo ──
  const mc = input.monteCarlo;
  if (mc && mc.metrics.mrr) {
    const probs = [
      `profitable in the final period: ${pct(mc.probabilities.profitability, 0)}`,
      ...(mc.probabilities.cashOut !== null ? [`cash-out: ${pct(mc.probabilities.cashOut, 0)}`] : []),
      ...(mc.probabilities.targetMrr !== null ? [`MRR ≥ ${$(mc.targets.mrr)}: ${pct(mc.probabilities.targetMrr, 0)}`] : []),
      ...(mc.probabilities.guardrailViolation !== null ? [`any guardrail breached: ${pct(mc.probabilities.guardrailViolation, 0)}`] : []),
    ];
    section(
      "monte_carlo",
      "Monte Carlo",
      `${count(mc.completed)} runs (seed ${mc.seed}) sampling ${mc.uncertainParameters.map((p) => p.name).join(", ") || "no uncertain assumptions"}. Probabilities — ${probs.join("; ")}.${mc.failed ? ` ${mc.failed} runs failed and are excluded.` : ""}`,
      {
        columns: ["Metric", "P10", "P50", "P90", "Mean"],
        rows: [
          ["Final MRR", $(mc.metrics.mrr.p10), $(mc.metrics.mrr.p50), $(mc.metrics.mrr.p90), $(mc.metrics.mrr.mean)],
          ...(mc.metrics.cash ? [["Final cash", $(mc.metrics.cash.p10), $(mc.metrics.cash.p50), $(mc.metrics.cash.p90), $(mc.metrics.cash.mean)]] : []),
          ...(mc.metrics.customers ? [["Customers", count(mc.metrics.customers.p10), count(mc.metrics.customers.p50), count(mc.metrics.customers.p90), count(mc.metrics.customers.mean)]] : []),
        ],
      },
    );
  } else {
    section("monte_carlo", "Monte Carlo", "Monte Carlo simulation has not been run for this report.");
  }

  // ── Questions to review (grounded in the numbers above) ──
  const questions: string[] = [];
  if (topDriver && sens) questions.push(`- ${topDriver.name} has the largest effect on ${metricName(sens.metric)}. How confident are you in ${byUnit(topDriver.baseValue, topDriver.unit, cur)}?`);
  if (cashOut) questions.push(`- Cash runs out in ${t[cashOut - 1]!.period}. What funding or cost changes would extend runway past that point?`);
  if (!be) questions.push(`- The model does not break even within ${t.length} periods. Which assumption would need to change to get there?`);
  if (pending.length) questions.push(`- Review the ${pending.length} AI-suggested assumption(s) before relying on these results.`);
  const lowConfidence = params.filter((p) => p.confidence === "low");
  if (lowConfidence.length) questions.push(`- Low-confidence assumptions: ${lowConfidence.map((p) => p.name).join(", ")}. Consider adding uncertainty and running Monte Carlo.`);
  if (!hasCash) questions.push("- Add a Cash node with your starting cash to see burn and runway.");
  section("recommendations", "Questions to review", questions.length ? questions.join("\n") : "No open questions were detected from this run.");

  return {
    id: input.reportId ?? `report-${result.runId}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64),
    modelId: model.id,
    modelVersion: model.version,
    runId: result.runId,
    title: `${model.name} — simulation report`,
    createdAt: input.generatedAt ?? new Date().toISOString(),
    sections,
  };
}

const STAGE_LABELS: Record<string, string> = { idea: "Idea", "pre-launch": "Pre-launch", "pre-seed": "Pre-seed", seed: "Seed", growth: "Growth", scale: "Scale" };

function milestonePeriods(n: number): number[] {
  const picks = new Set<number>([1]);
  const step = n <= 12 ? 3 : 6;
  for (let i = step; i < n; i += step) picks.add(i);
  picks.add(n);
  return [...picks].sort((a, b) => a - b);
}

const METRIC_NAMES: Record<string, string> = { mrr: "MRR", arr: "ARR", cash: "cash", customers: "customers", grossMargin: "gross margin", operatingProfit: "operating profit", revenue: "revenue" };
const metricName = (m: string) => METRIC_NAMES[m] ?? m;

function fmtMetric(metric: string, v: number | null, cur: Currency): string {
  if (v === null) return "n/a";
  if (metric === "grossMargin") return pct(v);
  if (metric === "customers") return count(v);
  return money(v, cur);
}

function describeDistribution(d: Model["parameters"][number]["distribution"], unit: string, cur: Currency): string {
  if (!d || d.type === "fixed") return "none";
  const f = (v: number) => byUnit(v, unit, cur);
  switch (d.type) {
    case "uniform":
      return `${f(d.min)} to ${f(d.max)}`;
    case "triangular":
      return `${f(d.min)} / ${f(d.mode)} / ${f(d.max)}`;
    case "normal":
      return `normal, σ ${f(d.stdDev)}`;
    case "lognormal":
      return `log-normal, σ ${f(d.stdDev)}`;
    case "discrete":
      return `${d.outcomes.length} outcomes`;
  }
}

/** Markdown rendering for copy/export. */
export function reportToMarkdown(report: Report): string {
  const out = [`# ${report.title}`, "", `Generated ${report.createdAt} · run ${report.runId}`, ""];
  for (const s of report.sections) {
    out.push(`## ${s.title}`, "", s.body, "");
    const table = (s.data as { table?: ReportTable } | undefined)?.table;
    if (table && table.rows.length) {
      out.push(`| ${table.columns.join(" | ")} |`, `| ${table.columns.map(() => "---").join(" | ")} |`, ...table.rows.map((r) => `| ${r.join(" | ")} |`), "");
    }
  }
  return out.join("\n");
}
