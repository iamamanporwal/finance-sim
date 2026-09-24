import { Decimal, ZERO } from "@fin/formula-engine";
import type {
  GuardrailResult,
  Model,
  SimulationEvent,
  SimulationSummary,
  TimelinePoint,
} from "@fin/model-schema";
import type { PortValues } from "./nodes";
import { monthsPerPeriod, type Period } from "./time";

type Outputs = ReadonlyMap<string, readonly PortValues[]>;

const num = (d: Decimal) => d.toNumber();
const numOrNull = (d: Decimal | null) => (d === null ? null : d.toNumber());

/**
 * Turns raw node outputs into financial statements per period.
 * Aggregation is driven purely by node roles (REVENUE, COST, ACQUISITION,
 * CUSTOMERS, CASH) — never by template-specific logic.
 */
export function buildTimeline(model: Model, periods: readonly Period[], outputs: Outputs): TimelinePoint[] {
  const months = new Decimal(monthsPerPeriod(model.settings.timeStep));
  const hasCash = model.nodes.some((n) => n.type === "CASH");

  return periods.map((period, i) => {
    const at = (id: string, port = "out"): Decimal => outputs.get(id)?.[i]?.[port] ?? ZERO;

    const revenue = { subscription: ZERO, usage: ZERO, topups: ZERO, other: ZERO };
    let cogs = ZERO;
    let opex = ZERO;
    const byCategory: Record<string, Decimal> = {};
    const customers = { opening: ZERO, new: ZERO, churned: ZERO, closing: ZERO };
    const cash = { opening: ZERO, inflow: ZERO, outflow: ZERO, closing: ZERO };

    for (const node of model.nodes) {
      switch (node.type) {
        case "REVENUE": {
          const key = node.config.revenueType === "topup" ? "topups" : node.config.revenueType;
          revenue[key] = revenue[key].plus(at(node.id));
          break;
        }
        case "COST": {
          const v = at(node.id);
          if (node.config.costClass === "cogs") cogs = cogs.plus(v);
          else opex = opex.plus(v);
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
          customers.new = customers.new.plus(at(node.id, "new")).minus(at(node.id, "moved"));
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

    const nodes: Record<string, Record<string, number>> = {};
    for (const node of model.nodes) {
      const values = outputs.get(node.id)?.[i];
      if (values) nodes[node.id] = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, num(v)]));
    }

    return {
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
      },
      nodes,
    };
  });
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
