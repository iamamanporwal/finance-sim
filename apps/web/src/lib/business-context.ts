/**
 * Business context: stage, the founder's questions, current state and actuals.
 * Stage and goals only change what is shown and suggested, never the financial
 * formulas. Every sentence built here quotes engine output or the user's own data.
 */
import type { BusinessStage, CurrentState, Model, SimulationResult, TimelinePoint } from "@fin/model-schema";
import { anchorFromActuals } from "@fin/simulation-engine";
import { formatCount, formatCurrency, formatMonths, formatPercent, type Currency } from "./format";
import * as ops from "./model-ops";

export interface StageInfo {
  label: string;
  description: string;
  /** Metrics to put first on the dashboard. */
  focus: string[];
  /** What to look at in the results at this stage. */
  reading: string;
}

export const STAGES: Record<BusinessStage, StageInfo> = {
  idea: { label: "Idea", description: "Exploring the idea; no product yet.", focus: ["cash", "burn", "runwayMonths", "grossMargin"], reading: "At this stage the model is a way to test whether the idea can work: check what price and margin it needs and how long your cash lasts." },
  "pre-launch": { label: "Pre-launch", description: "Building the product, not selling yet.", focus: ["cash", "burn", "runwayMonths", "customers"], reading: "Focus on runway until launch and on the first customers you need to prove the model." },
  "pre-seed": { label: "Pre-seed", description: "First customers, validating demand.", focus: ["cash", "burn", "runwayMonths", "customers", "mrr"], reading: "Cash, burn and runway come first; early revenue shows whether customers value the product." },
  seed: { label: "Seed", description: "Repeatable sales, growing revenue.", focus: ["mrr", "customers", "grossMargin", "cac", "runwayMonths", "churnRate"], reading: "MRR growth, retention, CAC and gross margin show whether growth is healthy; runway shows how long you have to prove it." },
  growth: { label: "Growth", description: "Scaling a working model.", focus: ["mrr", "nrr", "contributionMargin", "cacPaybackMonths", "operatingProfit"], reading: "Net revenue retention, contribution margin and CAC payback show whether each new dollar of growth pays for itself." },
  scale: { label: "Scale", description: "Mature, optimizing efficiency.", focus: ["arr", "operatingProfit", "contributionMargin", "nrr", "cash"], reading: "Operating leverage matters most: profit, contribution margin and retention at scale." },
};

export const BUSINESS_TYPES = [
  { id: "saas", label: "SaaS product" },
  { id: "ai-saas", label: "AI product" },
  { id: "usage-saas", label: "Usage-based / API" },
  { id: "credit-saas", label: "AI product with credits" },
  { id: "marketplace", label: "Marketplace" },
  { id: "other", label: "Something else" },
] as const;

export const REVENUE_MODELS = [
  { id: "subscription", label: "Monthly or annual subscriptions" },
  { id: "usage", label: "Pay per use" },
  { id: "credits", label: "Credits and top-ups" },
  { id: "take rate", label: "A cut of each transaction" },
  { id: "hybrid", label: "A mix of these" },
] as const;

export interface Goal {
  id: string;
  label: string;
  metrics: string[];
  /** Answer from engine output only. */
  answer(result: SimulationResult, currency: Currency): string;
}

const lastOf = (r: SimulationResult) => r.timeline[r.timeline.length - 1]!;
const minBy = (t: readonly TimelinePoint[], f: (p: TimelinePoint) => number) => t.reduce((m, p) => (f(p) < f(m) ? p : m), t[0]!);

export const GOALS: Goal[] = [
  {
    id: "cash-out",
    label: "Will I run out of cash?",
    metrics: ["cash", "runwayMonths"],
    answer(r, c) {
      const t = r.timeline;
      if (lastOf(r).metrics.cash === null) return "The model has no Cash node, so cash is not tracked.";
      const low = minBy(t, (p) => p.cash.closing);
      return r.summary.cashOutPeriod
        ? `Yes — cash runs out in ${t[r.summary.cashOutPeriod - 1]!.period} in this forecast.`
        : `Not within the forecast: cash stays positive through ${lastOf(r).period} (lowest ${formatCurrency(low.cash.closing, c)} in ${low.period}).`;
    },
  },
  {
    id: "growth",
    label: "How fast can I grow?",
    metrics: ["mrr", "customers"],
    answer(r, c) {
      const t = r.timeline;
      const first = t[0]!;
      const last = lastOf(r);
      return `Customers go from ${formatCount(first.customers.closing)} to ${formatCount(last.customers.closing)} and MRR from ${formatCurrency(first.metrics.mrr, c)} to ${formatCurrency(last.metrics.mrr, c)} between ${first.period} and ${last.period}.`;
    },
  },
  {
    id: "pricing",
    label: "Is my pricing sustainable?",
    metrics: ["grossMargin", "contributionMargin"],
    answer(r) {
      const last = lastOf(r);
      const low = minBy(r.timeline.filter((p) => p.profit.grossMargin !== null), (p) => p.profit.grossMargin!);
      if (!low) return "There is no revenue in the forecast yet, so margins are not defined.";
      return `Gross margin ends at ${formatPercent(last.profit.grossMargin)} (lowest ${formatPercent(low.profit.grossMargin)} in ${low.period}); contribution margin ends at ${formatPercent(last.metrics.contributionMargin)}.`;
    },
  },
  {
    id: "break-even",
    label: "When will I break even?",
    metrics: ["operatingProfit"],
    answer(r, c) {
      const be = r.summary.breakEvenPeriod;
      return be ? `In ${r.timeline[be - 1]!.period} (period ${be}), when operating profit turns positive.` : `Not within the forecast: operating profit in ${lastOf(r).period} is ${formatCurrency(lastOf(r).profit.operatingProfit, c)}.`;
    },
  },
  {
    id: "spend",
    label: "How much can I spend?",
    metrics: ["burn", "runwayMonths"],
    answer(r, c) {
      const peak = r.timeline.reduce((m, p) => ((p.metrics.burn ?? 0) > (m.metrics.burn ?? 0) ? p : m), r.timeline[0]!);
      if ((peak.metrics.burn ?? 0) <= 0) return "The forecast never burns cash, so current spending is covered by revenue every month.";
      const minRunway = r.timeline.filter((p) => p.metrics.runwayMonths !== null).reduce<TimelinePoint | null>((m, p) => (!m || p.metrics.runwayMonths! < m.metrics.runwayMonths! ? p : m), null);
      return `Burn peaks at ${formatCurrency(peak.metrics.burn, c)} in ${peak.period}${minRunway ? `; the shortest runway is ${formatMonths(minRunway.metrics.runwayMonths)} in ${minRunway.period}` : ""}. Try a what-if scenario with extra spend to see how it changes.`;
    },
  },
];

export function focusMetrics(model: Model): string[] {
  const stage = model.metadata.stage ? STAGES[model.metadata.stage].focus : [];
  const fromGoals = GOALS.filter((g) => model.metadata.goals?.includes(g.id)).flatMap((g) => g.metrics);
  return [...new Set([...stage, ...fromGoals])];
}

export type Health = "healthy" | "watch" | "risk" | "n/a";

/** Separate dimensions, never one score (PRD: avoid a misleading single number). Each shows the rule used. */
export function healthDimensions(result: SimulationResult): { dimension: string; status: Health; detail: string; rule: string }[] {
  const t = result.timeline;
  const last = lastOf(result);
  const hasCash = last.metrics.cash !== null;
  const minRunway = t.map((p) => p.metrics.runwayMonths).filter((v): v is number => v !== null && v !== undefined);
  const runway = minRunway.length ? Math.min(...minRunway) : null;
  const churn = last.metrics.churnRate ?? null;
  const margin = last.profit.grossMargin;
  const back = t[Math.max(0, t.length - 4)]!;
  const growth = back.metrics.mrr && back.metrics.mrr > 0 && t.length > 1 ? ((last.metrics.mrr ?? 0) / back.metrics.mrr) ** (1 / Math.min(3, t.length - 1)) - 1 : null;
  return [
    {
      dimension: "Cash",
      status: !hasCash ? "n/a" : result.summary.cashOutPeriod ? "risk" : runway !== null && runway < 12 ? "watch" : "healthy",
      detail: !hasCash ? "No Cash node" : result.summary.cashOutPeriod ? `Runs out in ${t[result.summary.cashOutPeriod - 1]!.period}` : runway !== null ? `Shortest runway ${formatMonths(runway)}` : "Not burning cash",
      rule: "Risk if cash runs out; watch if runway drops below 12 months.",
    },
    {
      dimension: "Growth",
      status: growth === null ? "n/a" : growth >= 0.05 ? "healthy" : growth > 0 ? "watch" : "risk",
      detail: growth === null ? "No recurring revenue yet" : `MRR ${growth >= 0 ? "+" : ""}${formatPercent(growth)} per month (last 3 months)`,
      rule: "Healthy at 5%+ monthly MRR growth; risk if MRR shrinks.",
    },
    {
      dimension: "Margin",
      status: margin === null ? "n/a" : margin >= 0.6 ? "healthy" : margin >= 0.4 ? "watch" : "risk",
      detail: margin === null ? "No revenue yet" : `Gross margin ${formatPercent(margin)}`,
      rule: "Healthy at 60%+ gross margin; risk below 40%.",
    },
    {
      dimension: "Retention",
      status: churn === null ? "n/a" : churn <= 0.03 ? "healthy" : churn <= 0.07 ? "watch" : "risk",
      detail: churn === null ? "No customers yet" : `Churn ${formatPercent(churn)} per period${last.metrics.nrr !== null && last.metrics.nrr !== undefined ? ` · NRR ${formatPercent(last.metrics.nrr)}` : ""}`,
      rule: "Healthy at ≤3% monthly churn; risk above 7%.",
    },
  ];
}

// ── Current state & actuals → forecast starting point ──

export interface StartingPointChange {
  what: string;
  from: string;
  to: string;
}

/**
 * Sets the forecast's starting point from known data (current state or latest
 * actuals): starting customers, starting cash and the start month. Only nodes
 * that unambiguously hold the value are changed; everything else is reported.
 */
export function applyStartingPoint(
  model: Model,
  data: { customers?: number; cash?: number; startDate?: string; label: string },
): { model: Model; changes: StartingPointChange[]; skipped: string[] } {
  let m = model;
  const changes: StartingPointChange[] = [];
  const skipped: string[] = [];
  const currency = model.settings.currency as Currency;
  const setInitial = (type: "CUSTOMERS" | "CASH", value: number, what: string, format: (v: number) => string) => {
    const nodes = m.nodes.filter((n) => n.type === type);
    if (nodes.length !== 1) {
      skipped.push(nodes.length === 0 ? `${what}: the model has no ${type === "CASH" ? "Cash" : "Customers"} node.` : `${what}: the model has ${nodes.length} ${type === "CASH" ? "Cash" : "Customers"} nodes (e.g. one per plan); set each one's starting value on the canvas.`);
      return;
    }
    const node = nodes[0]!;
    if (!node.parameters.initial) m = ops.bindNewParameter(m, node.id, "initial");
    const pid = m.nodes.find((n) => n.id === node.id)!.parameters.initial!;
    const before = m.parameters.find((p) => p.id === pid)!.value;
    if (before === value) return;
    m = ops.updateParameter(m, pid, { value, source: "imported", status: "accepted", confidence: "high", description: `From ${data.label}.` });
    changes.push({ what, from: format(before), to: format(value) });
  };
  if (data.customers !== undefined) setInitial("CUSTOMERS", data.customers, "Starting customers", (v) => formatCount(v));
  if (data.cash !== undefined) setInitial("CASH", data.cash, "Starting cash", (v) => formatCurrency(v, currency));
  if (data.startDate && data.startDate !== m.settings.startDate.slice(0, 7)) {
    changes.push({ what: "Forecast start", from: m.settings.startDate, to: data.startDate });
    m = ops.updateSettings(m, { startDate: data.startDate });
  }
  return { model: m, changes, skipped };
}

export function startingPointFromCurrentState(model: Model, cs: CurrentState) {
  return applyStartingPoint(model, { customers: cs.customers, cash: cs.cash, startDate: addMonth(cs.asOf), label: `your current state (${cs.asOf})` });
}

export function startingPointFromActuals(model: Model) {
  const a = anchorFromActuals(model);
  if (!a) return { model, changes: [], skipped: ["There are no actuals yet."] };
  return applyStartingPoint(model, { customers: a.customers, cash: a.cash, startDate: a.startDate, label: `actuals up to ${a.lastActual}` });
}

function addMonth(period: string): string {
  const [y, mo] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Where the forecast's first period disagrees with what the user says is true today. */
export function currentStateGaps(model: Model, result: SimulationResult | null): string[] {
  const cs = model.currentState;
  if (!cs || !result) return [];
  const first = result.timeline[0]!;
  const currency = model.settings.currency as Currency;
  const gaps: string[] = [];
  const off = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(b) * 0.05);
  if (cs.customers !== undefined && off(first.customers.opening, cs.customers)) gaps.push(`The forecast starts with ${formatCount(first.customers.opening)} customers, but you have ${formatCount(cs.customers)} today.`);
  if (cs.cash !== undefined && first.metrics.cash !== null && off(first.cash.opening, cs.cash)) gaps.push(`The forecast starts with ${formatCurrency(first.cash.opening, currency)} cash, but you have ${formatCurrency(cs.cash, currency)} today.`);
  if (cs.asOf >= first.period.slice(0, 7)) gaps.push(`Your current state is from ${cs.asOf}, but the forecast starts in ${first.period}.`);
  return gaps;
}
