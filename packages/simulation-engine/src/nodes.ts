import { compileFormula, Decimal, FormulaError, ONE, ZERO, type CompiledFormula } from "@fin/formula-engine";
import { formulaVariables, type ModelNode, type NodeOfType, type NodeType } from "@fin/model-schema";

export type PortValues = Record<string, Decimal>;

/** Everything a node evaluator may read for the current period. */
export interface NodeRuntime {
  /** 1-based period number. */
  period: number;
  periodsPerYear: number;
  /** Resolved slot value: connections (summed) → bound parameter → slot default. */
  input(slot: string): Decimal;
  /** True when the slot is connected or has a bound parameter. */
  has(slot: string): boolean;
  /** Node-private state carried between periods (stocks, growth factors, formula history). */
  state: Record<string, unknown>;
  /** Opening balance for stateful nodes, computed by `open` before any node runs this period. */
  opening: Decimal;
}

export class SimulationError extends Error {
  constructor(
    message: string,
    readonly nodeId: string,
    readonly period: number,
  ) {
    super(message);
    this.name = "SimulationError";
  }
}

export interface NodeBehavior<T extends NodeType = NodeType> {
  /**
   * Stocks only: opening balance for the period, computed from state before
   * any node is evaluated. Exposed as the lagged `opening` output.
   */
  open?(node: NodeOfType<T>, rt: Omit<NodeRuntime, "opening">): Decimal;
  evaluate(node: NodeOfType<T>, rt: NodeRuntime): PortValues;
}

const fail = (node: ModelNode, rt: { period: number }, message: string): never => {
  throw new SimulationError(`${node.label}: ${message}`, node.id, rt.period);
};

/** Previous closing balance, or the initial balance in the first period. */
const stockOpening = (_node: ModelNode, rt: Omit<NodeRuntime, "opening">): Decimal =>
  (rt.state.closing as Decimal | undefined) ?? rt.input("initial");

const BEHAVIORS: { [T in NodeType]: NodeBehavior<T> } = {
  INPUT: {
    evaluate: (_n, rt) => ({ out: rt.input("value") }),
  },

  GROWTH: {
    evaluate(node, rt) {
      const { growthType, startPeriod, endPeriod } = node.config;
      const growing = rt.period > startPeriod && (endPeriod === undefined || rt.period <= endPeriod);
      const rate = rt.input("rate");
      // factor: multiplier for compound/linear; offset: additive amount for absolute growth.
      let factor = (rt.state.factor as Decimal | undefined) ?? ONE;
      let offset = (rt.state.offset as Decimal | undefined) ?? ZERO;
      if (growing) {
        if (growthType === "compound") factor = factor.times(ONE.plus(rate));
        else if (growthType === "linear") factor = factor.plus(rate);
        else offset = offset.plus(rate);
      }
      rt.state.factor = factor;
      rt.state.offset = offset;
      const base = rt.input("base");
      return { out: growthType === "absolute" ? base.plus(offset) : base.times(factor) };
    },
  },

  ACQUISITION: {
    evaluate(node, rt) {
      const budget = rt.input("budget");
      const cac = rt.input("cac");
      const organic = rt.input("organic");
      if (budget.isNegative()) fail(node, rt, "marketing budget is negative.");
      let paid = ZERO;
      if (budget.gt(0)) {
        if (cac.lte(0)) fail(node, rt, "CAC must be greater than zero when there is a marketing budget.");
        paid = budget.div(cac);
      }
      return { out: paid.plus(organic), paid, organic, spend: budget };
    },
  },

  CONVERSION: {
    evaluate: (_n, rt) => ({ out: rt.input("input").times(rt.input("rate")) }),
  },

  CUSTOMERS: {
    open: stockOpening,
    evaluate(node, rt) {
      const opening = rt.opening;
      const added = rt.input("new");
      const churnRate = rt.input("churnRate");
      if (added.isNegative()) fail(node, rt, `new customers is negative (${added.toDecimalPlaces(2).toString()}).`);
      if (churnRate.isNegative() || churnRate.gt(1)) fail(node, rt, "churn rate must be between 0% and 100%.");
      const moved = rt.input("moved");
      if (moved.isNegative()) fail(node, rt, "moved-out customers is negative.");
      const churned = opening.times(churnRate);
      const closing = opening.plus(added).minus(churned).minus(moved);
      if (closing.isNegative()) fail(node, rt, "more customers churned or moved out than were available.");
      rt.state.closing = closing;
      return { out: closing, opening, new: added, churned, moved, inflow: added, outflow: churned.plus(moved) };
    },
  },

  CHURN: {
    evaluate(node, rt) {
      const rate = rt.input("rate");
      if (rate.isNegative() || rate.gt(1)) fail(node, rt, "churn rate must be between 0% and 100%.");
      if (node.config.basis === "annual") {
        // Equivalent per-period rate that compounds to the annual rate.
        return { out: ONE.minus(ONE.minus(rate).pow(ONE.div(rt.periodsPerYear))) };
      }
      return { out: rate };
    },
  },

  SPLIT: {
    evaluate(node, rt) {
      const input = rt.input("input");
      const out: PortValues = {};
      for (const b of node.config.branches) out[b.key] = input.times(rt.input(`weight.${b.key}`));
      return out;
    },
  },

  PRICE: {
    evaluate: (_n, rt) => ({ out: rt.input("price").times(ONE.minus(rt.input("discount"))) }),
  },

  REVENUE: {
    evaluate: (_n, rt) => ({ out: rt.input("quantity").times(rt.input("price")) }),
  },

  COST: {
    evaluate(node, rt) {
      const { costType, startPeriod, endPeriod, tiers } = node.config;
      const start = startPeriod ?? 1;
      if (rt.period < start || (endPeriod !== undefined && rt.period > endPeriod)) return { out: ZERO };
      switch (costType) {
        case "fixed":
          return { out: rt.input("amount").times(ONE.plus(rt.input("growth")).pow(rt.period - start)) };
        case "variable":
          return { out: rt.input("volume").times(rt.input("unitCost")) };
        case "percentage":
          return { out: rt.input("base").times(rt.input("rate")) };
        case "step": {
          const volume = rt.input("volume");
          const tier = (tiers ?? []).find((t) => t.upTo === undefined || volume.lte(t.upTo));
          if (!tier) return fail(node, rt, `volume ${volume.toDecimalPlaces(2).toString()} exceeds the highest tier. Add an open-ended tier.`);
          return { out: new Decimal(tier.cost) };
        }
      }
    },
  },

  POOL: {
    open: stockOpening,
    evaluate(_node, rt) {
      const opening = rt.opening;
      const inflow = rt.input("inflow");
      const outflow = rt.input("outflow");
      let closing = opening.plus(inflow).minus(outflow);
      let overflow = ZERO;
      let shortfall = ZERO;
      if (rt.has("maximum")) {
        const max = rt.input("maximum");
        if (closing.gt(max)) {
          overflow = closing.minus(max);
          closing = max;
        }
      }
      if (rt.has("minimum")) {
        const min = rt.input("minimum");
        if (closing.lt(min)) {
          shortfall = min.minus(closing);
          closing = min;
        }
      }
      rt.state.closing = closing;
      return { out: closing, opening, inflow, outflow, overflow, shortfall };
    },
  },

  CASH: {
    open: stockOpening,
    evaluate(_node, rt) {
      const opening = rt.opening;
      const inflow = rt.input("inflow");
      const outflow = rt.input("outflow");
      const closing = opening.plus(inflow).minus(outflow);
      rt.state.closing = closing;
      return { out: closing, opening, inflow, outflow };
    },
  },

  FLOW: {
    evaluate: (_n, rt) => ({ out: rt.input("amount").times(rt.input("multiplier")) }),
  },

  CAPACITY: {
    evaluate(node, rt) {
      const demand = rt.input("demand");
      const capacity = rt.input("capacity");
      if (capacity.isNegative()) fail(node, rt, "capacity is negative.");
      let utilization = ZERO;
      if (capacity.gt(0)) utilization = demand.div(capacity);
      else if (demand.gt(0)) fail(node, rt, "capacity is zero while demand is positive.");
      return {
        out: Decimal.min(demand, capacity),
        excess: Decimal.max(ZERO, demand.minus(capacity)),
        utilization,
      };
    },
  },

  CONDITION: {
    evaluate(node, rt) {
      const v = rt.input("value");
      const t = rt.input("threshold");
      const active = compare(v, node.config.operator, t);
      return { out: active ? rt.input("then") : rt.input("else"), active: active ? ONE : ZERO };
    },
  },

  FORMULA: {
    evaluate(node, rt) {
      let compiled = rt.state.compiled as CompiledFormula | undefined;
      if (!compiled) {
        try {
          compiled = compileFormula(node.config.expression);
        } catch (e) {
          return fail(node, rt, e instanceof Error ? e.message : String(e));
        }
        rt.state.compiled = compiled;
      }
      const history = (rt.state.history as Record<string, Decimal[]> | undefined) ?? {};
      const variables: Record<string, Decimal> = { period: new Decimal(rt.period) };
      for (const name of formulaVariables(node.config.expression)) variables[name] = rt.input(name);
      let out: Decimal;
      try {
        out = compiled.evaluate({
          variables,
          history: (name, lag) => {
            const h = history[name];
            return h && h.length >= lag ? h[h.length - lag] : undefined;
          },
        });
      } catch (e) {
        if (e instanceof FormulaError) return fail(node, rt, e.message);
        throw e;
      }
      for (const [name, v] of Object.entries(variables)) (history[name] ??= []).push(v);
      rt.state.history = history;
      return { out };
    },
  },
};

function compare(a: Decimal, op: string, b: Decimal): boolean {
  switch (op) {
    case ">":
      return a.gt(b);
    case ">=":
      return a.gte(b);
    case "<":
      return a.lt(b);
    case "<=":
      return a.lte(b);
    case "==":
      return a.eq(b);
    default:
      return !a.eq(b);
  }
}

export function behaviorFor(node: ModelNode): NodeBehavior {
  return BEHAVIORS[node.type] as NodeBehavior;
}
