import { findOutput, getMetricDefinition, NODE_CATALOG, outputsFor, slotsFor, type Model, type ModelNode, type Parameter, type SimulationResult, type SlotSpec, type TimelinePoint } from "@fin/model-schema";
import { METRIC_FORMULAS, METRIC_ROOT_TYPES } from "./explain";
import { resolveParameterValues } from "./validation";

/**
 * "Why?" — traces a metric or node value back through the dependency graph and
 * shows, at every step, the formula with the engine's own numbers filled in.
 * Nothing here estimates or rounds results: values are read from the
 * simulation result and the resolved assumptions that produced it.
 */

export type ValueKind = "currency" | "percent" | "count" | "months" | "number";

export interface WhyStep {
  /** Unique within the tree. */
  key: string;
  kind: "metric" | "node" | "assumption" | "default" | "carried";
  label: string;
  value: number | null;
  valueKind: ValueKind;
  /** Plain-language formula with values, e.g. "Customers × Price = 4,820 × $39". */
  formula?: string;
  nodeId?: string;
  port?: string;
  parameterId?: string;
  /** Where an assumption came from (user, AI, template, …) and how confident it is. */
  source?: Parameter["source"];
  confidence?: Parameter["confidence"];
  /** Explained earlier in the tree; children are omitted. */
  repeated?: boolean;
  children: WhyStep[];
}

export interface WhyExplanation {
  period: number;
  periodLabel: string;
  scenarioId: string | null;
  root: WhyStep;
  /** Main causal chain, e.g. ["MRR", "Subscription revenue", "Customers", "Conversion", "Signups"]. */
  chain: string[];
  /** Deterministic plain-language explanation built from the tree. */
  sentences: string[];
  /** Every value in the tree, for grounding AI explanations. */
  facts: { label: string; value: number; valueKind: ValueKind }[];
}

export type WhyTarget = { metric: string } | { nodeId: string; port?: string };

export interface WhyOptions {
  period?: number;
  /** Levels below the root to expand (default 6). */
  maxDepth?: number;
  format?: (value: number | null, kind: ValueKind) => string;
}

const MAX_STEPS = 250;

export function defaultFormat(value: number | null, kind: ValueKind): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  switch (kind) {
    case "percent":
      return `${sign}${(abs * 100).toFixed(abs * 100 >= 10 ? 1 : 2).replace(/\.?0+$/, "")}%`;
    case "currency":
      return `${sign}$${abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : abs >= 1e5 ? `${(abs / 1e3).toFixed(1)}K` : abs.toLocaleString("en-US", { maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
    case "months":
      return `${sign}${abs.toFixed(1)} months`;
    default:
      return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 2 : abs < 1000 ? 1 : 0 })}`;
  }
}

function slotKind(slot: SlotSpec | undefined, unit?: string): ValueKind {
  if (slot?.kind === "rate") return "percent";
  if (slot?.kind === "money") return "currency";
  if (slot?.kind === "count") return "count";
  return unitKind(unit);
}

function unitKind(unit?: string): ValueKind {
  if (!unit) return "number";
  if (unit === "percent") return "percent";
  if (/^(USD|INR)\b/.test(unit)) return "currency";
  if (unit === "months") return "months";
  return "count";
}

function nodeKind(node: ModelNode, port: string): ValueKind {
  if (["utilization", "burnDepth", "rationingRate", "breakageRate", "active"].includes(port)) return port === "active" ? "number" : "percent";
  switch (node.type) {
    case "REVENUE":
    case "PRICE":
    case "COST":
    case "CASH":
    case "REVENUE_RECOGNITION":
      return port === "units" ? "count" : "currency";
    case "CHURN":
      return "percent";
    case "ACQUISITION":
      return port === "spend" ? "currency" : "count";
    case "CUSTOMERS":
    case "CONVERSION":
    case "CREDIT_WALLET":
    case "SPLIT":
      return "count";
    default:
      return unitKind(node.unit);
  }
}

export function explainWhy(model: Model, result: SimulationResult, target: WhyTarget, options: WhyOptions = {}): WhyExplanation {
  const period = Math.min(Math.max(1, options.period ?? result.timeline.length), result.timeline.length);
  const point = result.timeline[period - 1]!;
  const fmt = options.format ?? defaultFormat;
  const maxDepth = options.maxDepth ?? 6;
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const params = new Map(model.parameters.map((p) => [p.id, p]));
  const values = resolveParameterValues(model, result.scenarioId);
  const expanded = new Set<string>();
  let count = 0;
  let seq = 0;

  const portValue = (id: string, port: string) => point.nodes[id]?.[port] ?? null;

  const assumptionStep = (pid: string, label: string, kind: ValueKind): WhyStep => {
    const p = params.get(pid);
    return {
      key: `a${seq++}`,
      kind: "assumption",
      label: p ? `${p.name}` : label,
      value: values.get(pid)?.toNumber() ?? null,
      valueKind: p?.unit ? unitKind(p.unit) === "number" ? kind : unitKind(p.unit) : kind,
      parameterId: pid,
      source: p?.source,
      confidence: p?.confidence,
      children: [],
    };
  };

  const nodeStep = (id: string, port: string, depth: number): WhyStep => {
    const node = nodes.get(id)!;
    const outLabel = port === "out" ? node.label : `${node.label} · ${findOutput(node, port)?.label ?? port}`;
    const step: WhyStep = { key: `n${seq++}`, kind: "node", label: outLabel, value: portValue(id, port), valueKind: nodeKind(node, port), nodeId: id, port, children: [] };
    count++;
    const visitKey = `${id}:${port}`;
    if (expanded.has(visitKey)) return { ...step, repeated: true };
    expanded.add(visitKey);
    // A stock's opening balance was produced last period: don't walk back in time.
    if (findOutput(node, port)?.lagged) {
      return { ...step, formula: period === 1 ? "starting balance" : `closing balance of ${result.timeline[period - 2]!.period}` };
    }
    const inputs = slotInputs(node, depth);
    step.children = inputs.children;
    step.formula = formulaWithValues(node, port, inputs.byName, step.value, fmt, point, result, period);
    return step;
  };

  const slotInputs = (node: ModelNode, depth: number) => {
    const byName = new Map<string, { label: string; value: number | null; kind: ValueKind }>();
    const children: WhyStep[] = [];
    for (const slot of slotsFor(node)) {
      const sources = model.connections.filter((c) => c.target === node.id && c.targetPort === slot.name);
      const kind = slotKind(slot, node.unit);
      if (sources.length > 0) {
        let total = 0;
        for (const c of sources) {
          const v = portValue(c.source, c.sourcePort) ?? 0;
          total += v;
          if (depth < maxDepth && count < MAX_STEPS) children.push(nodeStep(c.source, c.sourcePort, depth + 1));
          else children.push({ key: `n${seq++}`, kind: "node", label: nodes.get(c.source)?.label ?? c.source, value: v, valueKind: kind, nodeId: c.source, port: c.sourcePort, children: [] });
        }
        byName.set(slot.name, { label: slot.label, value: total, kind });
      } else if (node.parameters[slot.name]) {
        const a = assumptionStep(node.parameters[slot.name]!, slot.label, kind);
        children.push(a);
        byName.set(slot.name, { label: slot.label, value: a.value, kind: a.valueKind });
      } else if (slot.default !== undefined) {
        byName.set(slot.name, { label: slot.label, value: slot.default, kind });
        // Defaults that change nothing (0 discount, ×1) are noise; show the rest.
        const neutral = slot.default === 0 || (slot.name === "multiplier" && slot.default === 1);
        if (!neutral) children.push({ key: `d${seq++}`, kind: "default", label: `${slot.label} (default)`, value: slot.default, valueKind: kind, children: [] });
      }
    }
    return { byName, children };
  };

  let root: WhyStep;
  if ("metric" in target) {
    const def = getMetricDefinition(target.metric, model.customMetrics);
    const value = point.metrics[target.metric] ?? null;
    const kind: ValueKind = (def?.unit as ValueKind) ?? "number";
    const custom = model.customMetrics.find((m) => m.key === target.metric);
    const children: WhyStep[] = [];
    if (custom) {
      for (const [name, input] of Object.entries(custom.inputs)) {
        if ("metric" in input) {
          const d = getMetricDefinition(input.metric, model.customMetrics);
          children.push({ key: `m${seq++}`, kind: "metric", label: `${name} = ${d?.label ?? input.metric}`, value: point.metrics[input.metric] ?? null, valueKind: (d?.unit as ValueKind) ?? "number", children: [] });
        } else if (nodes.has(input.nodeId)) children.push(nodeStep(input.nodeId, input.port, 1));
      }
    } else {
      for (const n of metricRoots(model, target.metric)) children.push(nodeStep(n.id, metricPort(n), 1));
    }
    root = {
      key: "root",
      kind: "metric",
      label: def?.label ?? target.metric,
      value,
      valueKind: kind,
      formula: custom ? `${custom.expression}${custom.status === "needs_confirmation" ? " (placeholder definition — not confirmed)" : ""}` : metricFormula(target.metric, point, fmt),
      children,
    };
  } else {
    const node = nodes.get(target.nodeId);
    if (!node) throw new Error(`Unknown node "${target.nodeId}".`);
    root = nodeStep(node.id, target.port ?? "out", 0);
    root.key = "root";
  }

  const chain = mainChain(root);
  const facts: WhyExplanation["facts"] = [];
  const collect = (s: WhyStep) => {
    if (s.value !== null) facts.push({ label: s.label, value: s.value, valueKind: s.valueKind });
    s.children.forEach(collect);
  };
  collect(root);
  return { period, periodLabel: point.period, scenarioId: result.scenarioId, root, chain, sentences: sentencesFor(root, point.period, fmt), facts };
}

function metricRoots(model: Model, metric: string): ModelNode[] {
  const types = METRIC_ROOT_TYPES[metric] ?? [];
  return model.nodes.filter((n) => {
    if (!types.includes(n.type)) return false;
    if (["mrr", "arr", "newMrr", "nrr", "nrrAnnual"].includes(metric)) return n.type === "REVENUE" && n.config.revenueType === "subscription";
    if (metric === "cogs") return n.type === "COST" && n.config.costClass === "cogs";
    if (metric === "opex") return (n.type === "COST" && n.config.costClass === "opex") || n.type === "ACQUISITION";
    if (metric === "contribution" || metric === "contributionMargin") return n.type !== "COST" || n.config.costClass === "cogs" || n.config.costType !== "fixed";
    return true;
  });
}

function metricPort(n: ModelNode): string {
  if (n.type === "ACQUISITION") return "spend";
  return "out";
}

function metricFormula(metric: string, p: TimelinePoint, fmt: NonNullable<WhyOptions["format"]>): string {
  const $ = (v: number | null | undefined) => fmt(v ?? null, "currency");
  switch (metric) {
    case "grossMargin":
      return `(revenue − COGS) ÷ revenue = (${$(p.revenue.total)} − ${$(p.costs.cogs)}) ÷ ${$(p.revenue.total)}`;
    case "grossProfit":
      return `revenue − COGS = ${$(p.revenue.total)} − ${$(p.costs.cogs)}`;
    case "operatingProfit":
      return `revenue − all costs = ${$(p.revenue.total)} − ${$(p.costs.total)}`;
    case "arr":
      return `MRR × 12 = ${$(p.metrics.mrr)} × 12`;
    case "cash":
      return `opening cash + cash in − cash out = ${$(p.cash.opening)} + ${$(p.cash.inflow)} − ${$(p.cash.outflow)}`;
    case "runwayMonths":
      return `cash ÷ monthly burn = ${$(p.cash.closing)} ÷ ${$(p.metrics.burn)}`;
    case "customers":
      return `opening + new − churned = ${fmt(p.customers.opening, "count")} + ${fmt(p.customers.new, "count")} − ${fmt(p.customers.churned, "count")}`;
    case "contribution":
      return `gross profit − variable operating costs = ${$(p.profit.grossProfit)} − ${$(p.profit.grossProfit - (p.metrics.contribution ?? 0))}`;
    case "nrr":
      return `(MRR − new MRR) ÷ last period's MRR = (${$(p.metrics.mrr)} − ${$(p.metrics.newMrr)}) ÷ last period's MRR`;
    default:
      return METRIC_FORMULAS[metric] ?? metric;
  }
}

function formulaWithValues(
  node: ModelNode,
  port: string,
  inputs: Map<string, { label: string; value: number | null; kind: ValueKind }>,
  value: number | null,
  fmt: NonNullable<WhyOptions["format"]>,
  point: TimelinePoint,
  result: SimulationResult,
  period: number,
): string {
  const v = (slot: string) => {
    const i = inputs.get(slot);
    return i ? fmt(i.value, i.kind) : "—";
  };
  const own = point.nodes[node.id] ?? {};
  const out = (p: string, kind: ValueKind) => fmt(own[p] ?? null, kind);
  const equals = ` = ${fmt(value, nodeKind(node, port))}`;
  switch (node.type) {
    case "INPUT":
      return "assumption";
    case "REVENUE":
      return `quantity × price = ${v("quantity")} × ${v("price")}${equals}`;
    case "PRICE":
      return inputs.get("discount")?.value ? `price × (1 − discount) = ${v("price")} × (1 − ${v("discount")})${equals}` : `list price${equals}`;
    case "CONVERSION":
      return `input × rate = ${v("input")} × ${v("rate")}${equals}`;
    case "FLOW":
      return `amount × multiplier = ${v("amount")} × ${v("multiplier")}${equals}`;
    case "GROWTH": {
      const { growthType, startPeriod } = node.config;
      const n = Math.max(0, Math.min(period, node.config.endPeriod ?? period) - startPeriod);
      if (growthType === "compound") return `base × (1 + rate)^${n} = ${v("base")} × (1 + ${v("rate")})^${n}${equals}`;
      if (growthType === "linear") return `base × (1 + rate × ${n}) = ${v("base")} × (1 + ${v("rate")} × ${n})${equals}`;
      return `base + rate × ${n} = ${v("base")} + ${v("rate")} × ${n}${equals}`;
    }
    case "CUSTOMERS":
      if (port !== "out") break;
      return `opening + new${inputs.get("movedIn")?.value ? " + moved in" : ""} − churned${inputs.get("moved")?.value ? " − moved out" : ""} = ${out("opening", "count")} + ${out("new", "count")}${inputs.get("movedIn")?.value ? ` + ${out("movedIn", "count")}` : ""} − ${out("churned", "count")} (${v("churnRate")} of opening)${inputs.get("moved")?.value ? ` − ${out("moved", "count")}` : ""}${equals}`;
    case "CHURN":
      return node.config.basis === "annual" ? `annual rate ${v("rate")} converted to a per-period rate${equals}` : `churn rate per period${equals}`;
    case "ACQUISITION":
      return port === "spend" ? `marketing budget${equals}` : `budget ÷ CAC + organic = ${v("budget")} ÷ ${v("cac")} + ${v("organic")}${equals}`;
    case "COST":
      switch (node.config.costType) {
        case "fixed":
          return `fixed amount${inputs.get("growth")?.value ? ` growing ${v("growth")} per period` : ""} = ${v("amount")}${inputs.get("growth")?.value ? " base" : ""}${equals}`;
        case "variable":
          return `volume × cost per unit = ${v("volume")} × ${v("unitCost")}${equals}`;
        case "percentage":
          return `base × percentage = ${v("base")} × ${v("rate")}${equals}`;
        case "step":
          return `tier cost for volume ${v("volume")}${equals}`;
        case "capacity":
          return port === "out"
            ? `⌈volume ÷ capacity per unit⌉ × cost per unit = ⌈${v("volume")} ÷ ${v("capacityPerUnit")}⌉ × ${v("unitCost")} = ${out("units", "count")} × ${v("unitCost")}${equals}`
            : `⌈volume ÷ capacity per unit⌉ = ⌈${v("volume")} ÷ ${v("capacityPerUnit")}⌉${equals}`;
      }
      break;
    case "CASH":
      if (port === "out") return `opening + inflow − outflow = ${out("opening", "currency")} + ${v("inflow")} − ${v("outflow")}${equals}`;
      break;
    case "POOL":
      if (port === "out") return `opening + inflow − outflow = ${out("opening", "count")} + ${v("inflow")} − ${v("outflow")}${equals}`;
      break;
    case "CREDIT_WALLET":
      if (port === "out") return `opening + grants + purchases − burned − expired = ${out("opening", "count")} + ${v("grants")} + ${v("purchases")} − ${out("burned", "count")} − ${out("expired", "count")}${equals}`;
      if (port === "burned") return `min(demand, available) = min(${v("demand")}, ${fmt((own.opening ?? 0) + (own.inflow ?? 0), "count")})${equals}`;
      if (port === "expired") return `unused credits × expiry rate = ${fmt((own.opening ?? 0) + (own.inflow ?? 0) - (own.burned ?? 0), "count")} × ${v("expiryRate")}${equals}`;
      break;
    case "REVENUE_RECOGNITION":
      if (port === "out") return `min(available, to recognize + opening × rate) = min(${fmt((own.opening ?? 0) + (own.billed ?? 0), "currency")}, ${v("recognize")} + ${out("opening", "currency")} × ${v("recognitionRate")})${equals}`;
      break;
    case "SPLIT":
      return `input × ${port} share = ${v("input")} × ${v(`weight.${port}`)}${equals}`;
    case "CAPACITY":
      if (port === "out") return `min(demand, capacity) = min(${v("demand")}, ${v("capacity")})${equals}`;
      break;
    case "CONDITION":
      return `if value ${node.config.operator} threshold (${v("value")} ${node.config.operator} ${v("threshold")}) then ${v("then")} else ${v("else")}${equals}`;
    case "FORMULA":
      return `${node.config.expression}${equals}`;
  }
  void result;
  return `${NODE_CATALOG[node.type].formula}${equals}`;
}

/** Follows the largest-valued non-assumption input at each step. */
function mainChain(root: WhyStep): string[] {
  const chain = [root.label];
  let cur = root;
  for (let i = 0; i < 12; i++) {
    const next = cur.children
      .filter((c) => c.kind === "node" && !c.repeated && c.port !== "opening")
      .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0))[0];
    if (!next) break;
    chain.push(next.label);
    cur = next;
  }
  return chain;
}

function sentencesFor(root: WhyStep, periodLabel: string, fmt: NonNullable<WhyOptions["format"]>): string[] {
  const out: string[] = [`${root.label} is ${fmt(root.value, root.valueKind)} in ${periodLabel}.`];
  if (root.formula) out.push(`It is calculated as ${root.formula}.`);
  const walk = (s: WhyStep, depth: number) => {
    if (depth > 3) return;
    for (const c of s.children) {
      if (c.kind === "node" && c.formula && !c.repeated) out.push(`${c.label}: ${c.formula}.`);
      else if (c.kind === "assumption") out.push(`${c.label} is an assumption set to ${fmt(c.value, c.valueKind)}${c.source && c.source !== "user" ? ` (source: ${c.source === "ai" ? "AI suggestion" : c.source})` : ""}.`);
      walk(c, depth + 1);
    }
  };
  walk(root, 1);
  return out.slice(0, 14);
}

/** All output ports of a node, for pickers. */
export function whyPortsOf(node: ModelNode) {
  return outputsFor(node).map((o) => ({ port: o.name, label: o.label }));
}
