import { compileFormula, Decimal, FormulaError, ONE, ZERO, type CompiledFormula } from "@fin/formula-engine";
import type {
  GuardrailResult,
  Model,
  SimulationEvent,
  SimulationSummary,
  TimelinePoint,
} from "@fin/model-schema";
import type { PortValues } from "./nodes";
import { monthsPerPeriod, PERIODS_PER_YEAR, type Period } from "./time";

type Outputs = ReadonlyMap<string, readonly PortValues[]>;

const num = (d: Decimal) => d.toNumber();
const numOrNull = (d: Decimal | null) => (d === null ? null : d.toNumber());

/**
 * Turns raw node outputs into financial statements per period.
 * Aggregation is driven purely by node roles (REVENUE, COST, ACQUISITION,
 * CUSTOMERS, CASH) — never by template-specific logic.
 */
export function buildTimeline(
  model: Model,
  periods: readonly Period[],
  outputs: Outputs,
  options: { includeNodeValues?: boolean } = {},
): TimelinePoint[] {
  const includeNodeValues = options.includeNodeValues ?? true;
  const months = new Decimal(monthsPerPeriod(model.settings.timeStep));
  const hasCash = model.nodes.some((n) => n.type === "CASH");
  const periodsPerYear = PERIODS_PER_YEAR[model.settings.timeStep];
  const nodeTypes = new Map(model.nodes.map((n) => [n.id, n.type]));
  // Subscription revenue fed by Customers nodes: used to split MRR into new vs existing customers (NRR).
  const subscriptionSources = model.nodes
    .filter((n) => n.type === "REVENUE" && n.config.revenueType === "subscription")
    .map((n) => ({
      id: n.id,
      customers: model.connections.filter((c) => c.target === n.id && c.targetPort === "quantity" && c.sourcePort === "out" && nodeTypes.get(c.source) === "CUSTOMERS").map((c) => c.source),
      quantitySources: model.connections.filter((c) => c.target === n.id && c.targetPort === "quantity").map((c) => ({ id: c.source, port: c.sourcePort })),
    }));
  const customMetrics = compileCustomMetrics(model);
  // Chained wallets (plan credits whose unmet demand flows on to a top-up wallet): only demand that
  // enters the chain counts as demand, and only demand still unmet at the end counts as rationed.
  const walletIds = new Set(model.nodes.filter((n) => n.type === "CREDIT_WALLET").map((n) => n.id));
  const overflow = model.connections.filter((c) => walletIds.has(c.source) && c.sourcePort === "rationed" && walletIds.has(c.target) && c.targetPort === "demand");
  const passesOnRationed = new Set(overflow.map((c) => c.source));
  const history: Record<string, Decimal[]> = {};
  let previousMrr: Decimal | null = null;
  const monthlyNrr: (Decimal | null)[] = [];

  return periods.map((period, i) => {
    const at = (id: string, port = "out"): Decimal => outputs.get(id)?.[i]?.[port] ?? ZERO;

    const revenue = { subscription: ZERO, usage: ZERO, topups: ZERO, other: ZERO };
    let cogs = ZERO;
    let opex = ZERO;
    const byCategory: Record<string, Decimal> = {};
    const customers = { opening: ZERO, new: ZERO, churned: ZERO, closing: ZERO };
    const cash = { opening: ZERO, inflow: ZERO, outflow: ZERO, closing: ZERO };
    const credits = { available: ZERO, balance: ZERO, burned: ZERO, expired: ZERO, rationed: ZERO, demand: ZERO };
    let variableOpex = ZERO;
    let deferredRevenue = ZERO;

    for (const node of model.nodes) {
      switch (node.type) {
        case "REVENUE": {
          const key = node.config.revenueType === "topup" ? "topups" : node.config.revenueType;
          revenue[key] = revenue[key].plus(at(node.id));
          break;
        }
        case "REVENUE_RECOGNITION": {
          const key = node.config.revenueType === "topup" ? "topups" : node.config.revenueType;
          revenue[key] = revenue[key].plus(at(node.id));
          deferredRevenue = deferredRevenue.plus(at(node.id, "deferred"));
          break;
        }
        case "CREDIT_WALLET":
          credits.available = credits.available.plus(at(node.id, "opening")).plus(at(node.id, "inflow"));
          credits.balance = credits.balance.plus(at(node.id));
          credits.burned = credits.burned.plus(at(node.id, "burned"));
          credits.expired = credits.expired.plus(at(node.id, "expired"));
          if (!passesOnRationed.has(node.id)) credits.rationed = credits.rationed.plus(at(node.id, "rationed"));
          {
            // Demand arriving as another wallet's overflow was already counted there.
            let own = at(node.id, "burned").plus(at(node.id, "rationed"));
            for (const c of overflow) if (c.target === node.id) own = own.minus(at(c.source, "rationed"));
            credits.demand = credits.demand.plus(own);
          }
          break;
        case "COST": {
          const v = at(node.id);
          if (node.config.costClass === "cogs") cogs = cogs.plus(v);
          else {
            opex = opex.plus(v);
            if (node.config.costType !== "fixed") variableOpex = variableOpex.plus(v);
          }
          byCategory[node.config.category] = (byCategory[node.config.category] ?? ZERO).plus(v);
          break;
        }
        case "ACQUISITION": {
          const spend = at(node.id, "spend");
          opex = opex.plus(spend);
          byCategory.marketing = (byCategory.marketing ?? ZERO).plus(spend);
          break;
        }
        case "CUSTOMERS":
          customers.opening = customers.opening.plus(at(node.id, "opening"));
          // Moves between plans (upgrades/downgrades) net out: they are not new customers overall.
          customers.new = customers.new.plus(at(node.id, "new")).plus(at(node.id, "movedIn")).minus(at(node.id, "moved"));
          customers.churned = customers.churned.plus(at(node.id, "churned"));
          customers.closing = customers.closing.plus(at(node.id));
          break;
        case "CASH":
          cash.opening = cash.opening.plus(at(node.id, "opening"));
          cash.inflow = cash.inflow.plus(at(node.id, "inflow"));
          cash.outflow = cash.outflow.plus(at(node.id, "outflow"));
          cash.closing = cash.closing.plus(at(node.id));
          break;
        default:
          break;
      }
    }

    const totalRevenue = revenue.subscription.plus(revenue.usage).plus(revenue.topups).plus(revenue.other);
    const totalCosts = cogs.plus(opex);
    const grossProfit = totalRevenue.minus(cogs);
    const grossMargin = totalRevenue.gt(0) ? grossProfit.div(totalRevenue) : null;
    const operatingProfit = totalRevenue.minus(totalCosts);
    // Without a Cash node, burn falls back to operating loss.
    const netCashFlow = hasCash ? cash.inflow.minus(cash.outflow) : operatingProfit;
    const burn = netCashFlow.isNegative() ? netCashFlow.neg() : ZERO;
    const mrr = revenue.subscription.div(months);
    const runwayMonths = !hasCash || burn.isZero() ? null : Decimal.max(ZERO, cash.closing).div(burn).times(months);
    // CAC = marketing spend ÷ new customers; payback = CAC ÷ (monthly ARPU × gross margin).
    const marketing = byCategory.marketing ?? ZERO;
    const cac = marketing.gt(0) && customers.new.gt(0) ? marketing.div(customers.new) : null;
    const monthlyArpu = customers.closing.gt(0) ? totalRevenue.div(customers.closing).div(months) : null;
    const monthlyGrossProfitPerCustomer = monthlyArpu && grossMargin && grossMargin.gt(0) ? monthlyArpu.times(grossMargin) : null;
    const cacPaybackMonths = cac && monthlyGrossProfitPerCustomer ? cac.div(monthlyGrossProfitPerCustomer) : null;
    const contribution = grossProfit.minus(variableOpex);

    // New MRR: new customers × the revenue per customer of the plan they joined.
    let newRevenue = ZERO;
    for (const r of subscriptionSources) {
      const quantity = r.quantitySources.reduce((sum, q) => sum.plus(at(q.id, q.port)), ZERO);
      if (quantity.lte(0)) continue;
      const perUnit = at(r.id).div(quantity);
      for (const c of r.customers) newRevenue = newRevenue.plus(at(c, "new").times(perUnit));
    }
    const newMrr = newRevenue.div(months);
    const nrr = previousMrr && previousMrr.gt(0) ? mrr.minus(newMrr).div(previousMrr) : null;
    monthlyNrr.push(nrr);
    previousMrr = mrr;
    const lastYear = monthlyNrr.slice(-periodsPerYear);
    const nrrAnnual = periodsPerYear > 1 && lastYear.length === periodsPerYear && lastYear.every((v) => v !== null) ? lastYear.reduce<Decimal>((acc, v) => acc.times(v!), ONE) : null;
    const hasCredits = credits.available.gt(0) || credits.demand.gt(0);
    const share = (a: Decimal, b: Decimal) => (b.gt(0) ? num(a.div(b)) : null);

    const nodes: Record<string, Record<string, number>> = {};
    for (const node of includeNodeValues ? model.nodes : []) {
      const values = outputs.get(node.id)?.[i];
      if (values) nodes[node.id] = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, num(v)]));
    }

    const point: TimelinePoint = {
      index: period.index,
      period: period.label,
      startDate: period.startDate,
      customers: { opening: num(customers.opening), new: num(customers.new), churned: num(customers.churned), closing: num(customers.closing) },
      revenue: {
        subscription: num(revenue.subscription),
        usage: num(revenue.usage),
        topups: num(revenue.topups),
        other: num(revenue.other),
        total: num(totalRevenue),
      },
      costs: {
        cogs: num(cogs),
        opex: num(opex),
        byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, num(v)])),
        total: num(totalCosts),
      },
      profit: { grossProfit: num(grossProfit), grossMargin: numOrNull(grossMargin), operatingProfit: num(operatingProfit) },
      cash: { opening: num(cash.opening), inflow: num(cash.inflow), outflow: num(cash.outflow), closing: num(cash.closing) },
      metrics: {
        revenue: num(totalRevenue),
        mrr: num(mrr),
        arr: num(mrr.times(12)),
        cogs: num(cogs),
        grossProfit: num(grossProfit),
        grossMargin: numOrNull(grossMargin),
        opex: num(opex),
        totalCosts: num(totalCosts),
        operatingProfit: num(operatingProfit),
        customers: num(customers.closing),
        newCustomers: num(customers.new),
        churnedCustomers: num(customers.churned),
        churnRate: customers.opening.gt(0) ? num(customers.churned.div(customers.opening)) : null,
        arpu: customers.closing.gt(0) ? num(totalRevenue.div(customers.closing)) : null,
        cash: hasCash ? num(cash.closing) : null,
        netCashFlow: num(netCashFlow),
        burn: num(burn),
        runwayMonths: numOrNull(runwayMonths),
        cac: numOrNull(cac),
        cacPaybackMonths: numOrNull(cacPaybackMonths),
        contribution: num(contribution),
        contributionMargin: totalRevenue.gt(0) ? num(contribution.div(totalRevenue)) : null,
        newMrr: num(newMrr),
        nrr: numOrNull(nrr),
        nrrAnnual: numOrNull(nrrAnnual),
        deferredRevenue: num(deferredRevenue),
        creditBalance: hasCredits ? num(credits.balance) : null,
        creditsBurned: hasCredits ? num(credits.burned) : null,
        creditsExpired: hasCredits ? num(credits.expired) : null,
        burnDepth: hasCredits ? share(credits.burned, credits.available) : null,
        breakageRate: hasCredits ? share(credits.expired, credits.available) : null,
        rationingRate: hasCredits ? share(credits.rationed, credits.demand) : null,
      } as Record<string, number | null>,
      nodes,
    };
    evaluateCustomMetrics(customMetrics, point, at, history);
    return point;
  });
}

interface CompiledMetric {
  key: string;
  formula: CompiledFormula | null;
  inputs: [string, { metric: string } | { nodeId: string; port: string }][];
}

function compileCustomMetrics(model: Model): CompiledMetric[] {
  return model.customMetrics.map((m) => {
    let formula: CompiledFormula | null = null;
    try {
      formula = compileFormula(m.expression);
    } catch {
      formula = null; // reported by validation
    }
    return { key: m.key, formula, inputs: Object.entries(m.inputs) };
  });
}

/**
 * Custom metrics are formulas over metrics and node outputs, evaluated after the
 * built-in metrics. A metric is empty (null) for a period when an input is empty
 * or the formula cannot be evaluated (e.g. division by zero).
 */
function evaluateCustomMetrics(metrics: CompiledMetric[], point: TimelinePoint, at: (id: string, port?: string) => Decimal, history: Record<string, Decimal[]>) {
  for (const m of metrics) {
    const variables: Record<string, Decimal> = { period: new Decimal(point.index) };
    let missing = !m.formula;
    for (const [name, input] of m.inputs) {
      if ("metric" in input) {
        const v = point.metrics[input.metric];
        if (v === null || v === undefined) missing = true;
        else variables[name] = new Decimal(v);
      } else variables[name] = at(input.nodeId, input.port);
    }
    let value: number | null = null;
    if (!missing) {
      try {
        value = m.formula!.evaluate({
          variables,
          history: (name, lag) => {
            const h = history[`${m.key}.${name}`];
            return h && h.length >= lag ? h[h.length - lag] : undefined;
          },
        }).toNumber();
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
      }
    }
    for (const [name, v] of Object.entries(variables)) (history[`${m.key}.${name}`] ??= []).push(v);
    point.metrics[m.key] = value !== null && Number.isFinite(value) ? value : null;
  }
}

export function buildEvents(model: Model, timeline: readonly TimelinePoint[]): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const hasCash = model.nodes.some((n) => n.type === "CASH");

  const breakEven = findBreakEven(timeline);
  if (breakEven !== null) {
    const p = timeline[breakEven - 1]!;
    events.push({
      period: breakEven,
      type: "break_even",
      severity: "info",
      message: breakEven === 1 ? `Operating profit is positive from the first period (${p.period}).` : `Break-even reached in ${p.period}: operating profit turns positive.`,
    });
  }

  const cashOut = hasCash ? findCashOut(timeline) : null;
  if (cashOut !== null) {
    events.push({ period: cashOut, type: "cash_negative", severity: "critical", message: `Cash runs out in ${timeline[cashOut - 1]!.period}.` });
  }

  for (const node of model.nodes) {
    if (node.type === "CAPACITY") {
      for (const p of timeline) {
        const excess = p.nodes[node.id]?.excess ?? 0;
        if (excess > 0) {
          events.push({
            period: p.index,
            type: "capacity_exceeded",
            severity: "warning",
            message: `${node.label}: demand exceeds capacity by ${formatNumber(excess)}.`,
            nodeId: node.id,
          });
        }
      }
    }
    if (node.type === "CONDITION" && node.config.eventLabel) {
      for (const p of timeline) {
        if ((p.nodes[node.id]?.active ?? 0) === 1) {
          events.push({ period: p.index, type: "condition", severity: "info", message: node.config.eventLabel, nodeId: node.id });
        }
      }
    }
  }

  return events.sort((a, b) => a.period - b.period);
}

/** First period with positive revenue and non-negative operating profit. */
export function findBreakEven(timeline: readonly TimelinePoint[]): number | null {
  return timeline.find((p) => p.revenue.total > 0 && p.profit.operatingProfit >= 0)?.index ?? null;
}

/** First period whose closing cash is negative. */
export function findCashOut(timeline: readonly TimelinePoint[]): number | null {
  return timeline.find((p) => p.cash.closing < 0)?.index ?? null;
}

/** One event per guardrail violation, so every period shows its warnings. */
export function guardrailEvents(model: Model, results: readonly GuardrailResult[], timeline: readonly TimelinePoint[]): SimulationEvent[] {
  const byId = new Map(model.guardrails.map((g) => [g.id, g]));
  return results.flatMap((r) => {
    const g = byId.get(r.guardrailId)!;
    return r.violations.map((period) => {
      const value = timeline[period - 1]?.metrics[g.metric];
      return {
        period,
        type: g.metric === "grossMargin" ? ("margin_warning" as const) : ("guardrail" as const),
        severity: g.severity,
        message: `Guardrail "${g.label}" not met (${formatMetric(g.metric, value ?? null)}).`,
        guardrailId: g.id,
      };
    });
  });
}

function formatMetric(metric: string, value: number | null): string {
  if (value === null) return "n/a";
  if (metric === "grossMargin" || metric === "churnRate") return `${(value * 100).toFixed(1)}%`;
  if (metric === "runwayMonths") return `${value.toFixed(1)} months`;
  return formatNumber(value);
}

export function evaluateGuardrails(model: Model, timeline: readonly TimelinePoint[]): GuardrailResult[] {
  return model.guardrails
    .filter((g) => g.enabled)
    .map((g) => {
      const violations: number[] = [];
      for (const p of timeline) {
        const v = p.metrics[g.metric];
        // A metric that is undefined for the period (e.g. margin with no revenue) cannot violate a guardrail.
        if (v === null || v === undefined) continue;
        const ok = g.operator === ">" ? v > g.threshold : g.operator === ">=" ? v >= g.threshold : g.operator === "<" ? v < g.threshold : v <= g.threshold;
        if (!ok) violations.push(p.index);
      }
      return { guardrailId: g.id, violations, passed: violations.length === 0 };
    });
}

export function buildSummary(model: Model, timeline: readonly TimelinePoint[]): SimulationSummary {
  const last = timeline[timeline.length - 1];
  const hasCash = model.nodes.some((n) => n.type === "CASH");
  if (!last) throw new Error("Cannot summarize an empty timeline.");
  return {
    mrr: last.metrics.mrr ?? 0,
    arr: last.metrics.arr ?? 0,
    revenue: last.revenue.total,
    customers: last.customers.closing,
    grossMargin: last.profit.grossMargin,
    cash: hasCash ? last.cash.closing : null,
    burn: last.metrics.burn ?? 0,
    runwayMonths: last.metrics.runwayMonths ?? null,
    breakEvenPeriod: findBreakEven(timeline),
    cashOutPeriod: hasCash ? findCashOut(timeline) : null,
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
