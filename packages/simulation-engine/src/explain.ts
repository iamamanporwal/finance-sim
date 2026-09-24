import type { Model, SimulationResult, TimelinePoint } from "@fin/model-schema";
import { DependencyGraph } from "./graph";

/**
 * Plain-language explanations built only from engine output. No AI, no guesses:
 * every number quoted here comes from the simulation result.
 */

const money = (v: number) => {
  const abs = Math.abs(v);
  const s = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(2)}M` : abs >= 10_000 ? `$${(abs / 1000).toFixed(1)}K` : `$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return v < 0 ? `−${s}` : s;
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const change = (from: number, to: number) => (to === from ? "unchanged" : from === 0 ? (to === 0 ? "unchanged" : "up from zero") : `${to >= from ? "up" : "down"} ${Math.abs(((to - from) / Math.abs(from)) * 100).toFixed(1)}%`);

export interface GuardrailExplanation {
  headline: string;
  cause: string;
  details: string[];
  /** Period used as the comparison point (last period the guardrail passed), if any. */
  referencePeriod: number | null;
}

function nodeValue(p: TimelinePoint, id: string, port = "out"): number {
  return p.nodes[id]?.[port] ?? 0;
}

/** Explains why a guardrail was violated in a period by comparing it with the last passing period. */
export function explainGuardrail(model: Model, result: SimulationResult, guardrailId: string, period: number): GuardrailExplanation {
  const g = model.guardrails.find((x) => x.id === guardrailId);
  const point = result.timeline[period - 1];
  if (!g || !point) return { headline: "Unknown guardrail or period.", cause: "", details: [], referencePeriod: null };
  const violations = new Set(result.guardrails.find((r) => r.guardrailId === g.id)?.violations ?? []);
  let ref: number | null = null;
  for (let i = period - 1; i >= 1; i--) if (!violations.has(i)) {
    ref = i;
    break;
  }
  const refPoint = ref ? result.timeline[ref - 1]! : null;
  const value = point.metrics[g.metric];
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : g.metric === "grossMargin" || g.metric === "churnRate" ? pct(v) : g.metric.endsWith("Months") ? `${v.toFixed(1)} months` : g.metric === "customers" ? v.toFixed(0) : money(v));
  const verb = g.operator.startsWith(">") ? "fell below" : "rose above";
  const headline = `${g.label.replace(/\s*[<>]=?.*$/, "") || g.metric} ${verb} ${fmt(g.threshold)} in ${point.period} (${fmt(value)}).`;
  const details: string[] = [];
  let cause = "";

  const costNodes = model.nodes.filter((n) => n.type === "COST" || n.type === "ACQUISITION");
  const costOf = (p: TimelinePoint, id: string) => (model.nodes.find((n) => n.id === id)?.type === "ACQUISITION" ? nodeValue(p, id, "spend") : nodeValue(p, id));
  const biggestMover = (ids: string[], from: TimelinePoint | null, to: TimelinePoint) =>
    ids
      .map((id) => ({ id, label: model.nodes.find((n) => n.id === id)!.label, from: from ? costOf(from, id) : 0, to: costOf(to, id) }))
      .sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  const largest = (ids: string[], p: TimelinePoint) =>
    ids.map((id) => ({ label: model.nodes.find((n) => n.id === id)!.label, v: costOf(p, id) })).sort((a, b) => b.v - a.v)[0];

  switch (g.metric) {
    case "grossMargin": {
      const cogsIds = costNodes.filter((n) => n.type === "COST" && n.config.costClass === "cogs").map((n) => n.id);
      if (refPoint) {
        const mover = biggestMover(cogsIds, refPoint, point);
        cause = `COGS grew faster than revenue since ${refPoint.period}: COGS ${change(refPoint.costs.cogs, point.costs.cogs)} (${money(refPoint.costs.cogs)} → ${money(point.costs.cogs)}) while revenue was ${change(refPoint.revenue.total, point.revenue.total)} (${money(refPoint.revenue.total)} → ${money(point.revenue.total)}).`;
        if (mover && mover.to !== mover.from) details.push(`Largest COGS increase: ${mover.label} (${money(mover.from)} → ${money(mover.to)}).`);
      } else {
        const top = largest(cogsIds, point);
        cause = `Margin is below the limit from the first period: COGS is ${money(point.costs.cogs)} against revenue of ${money(point.revenue.total)}.`;
        if (top) details.push(`Largest COGS item: ${top.label} (${money(top.v)}).`);
      }
      break;
    }
    case "cash":
    case "runwayMonths":
    case "burn": {
      const all = costNodes.map((n) => n.id);
      const top = largest(all, point);
      cause = `Costs of ${money(point.costs.total)} exceeded revenue of ${money(point.revenue.total)} in ${point.period}, a burn of ${money(point.metrics.burn ?? 0)} with ${money(point.cash.closing)} left.`;
      if (top) details.push(`Largest cost: ${top.label} (${money(top.v)} per period).`);
      if (refPoint) {
        const mover = biggestMover(all, refPoint, point);
        if (mover && mover.to > mover.from) details.push(`Fastest-growing cost since ${refPoint.period}: ${mover.label} (${money(mover.from)} → ${money(mover.to)}).`);
      }
      break;
    }
    case "churnRate": {
      cause = `${point.customers.churned.toFixed(1)} of ${point.customers.opening.toFixed(1)} opening customers churned in ${point.period}.`;
      break;
    }
    case "cacPaybackMonths":
    case "cac": {
      cause = `Marketing spend of ${money(point.costs.byCategory.marketing ?? 0)} brought ${point.customers.new.toFixed(1)} new customers (CAC ${money(point.metrics.cac ?? 0)}).`;
      break;
    }
    default: {
      cause = refPoint ? `${g.metric} moved from ${fmt(refPoint.metrics[g.metric])} in ${refPoint.period} to ${fmt(value)}.` : `${g.metric} is ${fmt(value)} from the first period.`;
    }
  }
  return { headline, cause, details, referencePeriod: ref };
}

export interface MetricDriver {
  nodeId: string;
  label: string;
  /** Main output value of the node in the period. */
  value: number;
  /** Distance from the metric (1 = directly feeds it). */
  depth: number;
}

export interface MetricExplanation {
  metric: string;
  period: number;
  periodLabel: string;
  value: number | null;
  formula: string;
  /** Nodes that directly make up the metric. */
  components: { label: string; value: number }[];
  /** Upstream causal chain, nearest first. */
  drivers: MetricDriver[];
}

const METRIC_ROOT_TYPES: Record<string, string[]> = {
  revenue: ["REVENUE"],
  mrr: ["REVENUE"],
  arr: ["REVENUE"],
  arpu: ["REVENUE", "CUSTOMERS"],
  cogs: ["COST"],
  grossProfit: ["REVENUE", "COST"],
  grossMargin: ["REVENUE", "COST"],
  opex: ["COST", "ACQUISITION"],
  totalCosts: ["COST", "ACQUISITION"],
  operatingProfit: ["REVENUE", "COST", "ACQUISITION"],
  customers: ["CUSTOMERS"],
  newCustomers: ["CUSTOMERS"],
  churnedCustomers: ["CUSTOMERS"],
  churnRate: ["CUSTOMERS"],
  cash: ["CASH"],
  netCashFlow: ["CASH"],
  burn: ["CASH"],
  runwayMonths: ["CASH"],
  cac: ["ACQUISITION", "COST"],
  cacPaybackMonths: ["ACQUISITION", "REVENUE"],
};

const METRIC_FORMULAS: Record<string, string> = {
  revenue: "sum of all revenue nodes",
  mrr: "subscription revenue per month",
  arr: "MRR × 12",
  arpu: "revenue ÷ customers",
  cogs: "sum of cost nodes marked COGS",
  grossProfit: "revenue − COGS",
  grossMargin: "(revenue − COGS) ÷ revenue",
  opex: "sum of operating expenses (including marketing spend)",
  totalCosts: "COGS + operating expenses",
  operatingProfit: "revenue − all costs",
  customers: "opening customers + new − churned",
  newCustomers: "customers added in the period",
  churnedCustomers: "opening customers × churn rate",
  churnRate: "churned ÷ opening customers",
  cash: "opening cash + inflows − outflows",
  netCashFlow: "cash inflows − cash outflows",
  burn: "net cash outflow per period",
  runwayMonths: "cash ÷ monthly burn",
  cac: "marketing spend ÷ new customers",
  cacPaybackMonths: "CAC ÷ (monthly ARPU × gross margin)",
};

/** Traces a metric back through the dependency graph with engine values ("Why?"). */
export function explainMetric(model: Model, result: SimulationResult, metric: string, period?: number): MetricExplanation {
  const p = Math.min(Math.max(1, period ?? result.timeline.length), result.timeline.length);
  const point = result.timeline[p - 1]!;
  const types = METRIC_ROOT_TYPES[metric] ?? [];
  const roots = model.nodes.filter((n) => types.includes(n.type) && (metric !== "cogs" || (n.type === "COST" && n.config.costClass === "cogs")));
  const graph = DependencyGraph.fromModel(model);
  const components = roots.map((n) => ({ label: n.label, value: nodeValue(point, n.id, n.type === "ACQUISITION" ? "spend" : "out") }));

  // Breadth-first walk upstream from the metric's component nodes.
  const depth = new Map<string, number>(roots.map((n) => [n.id, 0]));
  const queue = roots.map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const dep of graph.dependenciesOf(id)) {
      if (!depth.has(dep)) {
        depth.set(dep, depth.get(id)! + 1);
        queue.push(dep);
      }
    }
  }
  const drivers = [...depth.entries()]
    .filter(([, d]) => d > 0)
    .sort((a, b) => a[1] - b[1])
    .map(([id, d]) => ({ nodeId: id, label: graph.labelOf(id), value: nodeValue(point, id), depth: d }));

  return { metric, period: p, periodLabel: point.period, value: point.metrics[metric] ?? null, formula: METRIC_FORMULAS[metric] ?? metric, components, drivers };
}
