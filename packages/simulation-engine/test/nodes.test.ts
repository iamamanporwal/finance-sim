import { describe, expect, it } from "vitest";
import { simulate, SimulationError } from "../src";
import { makeModel } from "./helpers";

const series = (r: ReturnType<typeof simulate>, id: string, port = "out") => r.timeline.map((p) => p.nodes[id]![port]);

describe("INPUT", () => {
  it("outputs its value every period", () => {
    const r = simulate(makeModel({ nodes: [{ id: "a", type: "INPUT", label: "A", parameters: { value: "p" } }], params: [{ id: "p", value: 800 }] }, { horizon: 3 }));
    expect(series(r, "a")).toEqual([800, 800, 800]);
  });
});

describe("GROWTH", () => {
  const growth = (config: object, rate: number, horizon = 4) =>
    series(
      simulate(
        makeModel(
          {
            nodes: [{ id: "g", type: "GROWTH", label: "G", parameters: { base: "b", rate: "r" }, config } as never],
            params: [{ id: "b", value: 100 }, { id: "r", value: rate }],
          },
          { horizon },
        ),
      ),
      "g",
    );
  it("compound", () => expect(growth({ growthType: "compound" }, 0.1)).toEqual([100, 110, 121, 133.1]));
  it("linear", () => expect(growth({ growthType: "linear" }, 0.1)).toEqual([100, 110, 120, 130]));
  it("absolute", () => expect(growth({ growthType: "absolute" }, 25)).toEqual([100, 125, 150, 175]));
  it("respects start and end periods", () => {
    expect(growth({ growthType: "compound", startPeriod: 2, endPeriod: 3 }, 0.1, 5)).toEqual([100, 100, 110, 110, 110]);
  });
  it("supports negative growth", () => expect(growth({ growthType: "compound" }, -0.5)).toEqual([100, 50, 25, 12.5]));
});

describe("ACQUISITION", () => {
  it("paid = budget ÷ CAC, plus organic; spend counts as marketing cost", () => {
    const r = simulate(
      makeModel({
        nodes: [{ id: "a", type: "ACQUISITION", label: "Ads", parameters: { budget: "b", cac: "c", organic: "o" } }],
        params: [{ id: "b", value: 10000 }, { id: "c", value: 250 }, { id: "o", value: 15 }],
      }, { horizon: 1 }),
    );
    expect(r.timeline[0]!.nodes.a).toEqual({ out: 55, paid: 40, organic: 15, spend: 10000 });
    expect(r.timeline[0]!.costs.byCategory.marketing).toBe(10000);
    expect(r.timeline[0]!.costs.opex).toBe(10000);
  });
  it("errors when budget > 0 and CAC is zero", () => {
    const m = makeModel({
      nodes: [{ id: "a", type: "ACQUISITION", label: "Ads", parameters: { budget: "b", cac: "c" } }],
      params: [{ id: "b", value: 100 }, { id: "c", value: 0 }],
    });
    expect(() => simulate(m)).toThrow("Ads: CAC must be greater than zero when there is a marketing budget.");
  });
});

describe("CUSTOMERS + CHURN", () => {
  it("applies churn to opening customers and starts from the initial value", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "c", type: "CUSTOMERS", label: "Customers", parameters: { initial: "i", new: "n" } },
            { id: "ch", type: "CHURN", label: "Churn", parameters: { rate: "r" } },
          ],
          connections: [["ch", "c", "churnRate"]],
          params: [{ id: "i", value: 1000 }, { id: "n", value: 100 }, { id: "r", value: 0.1 }],
        },
        { horizon: 2 },
      ),
    );
    expect(r.timeline[0]!.customers).toEqual({ opening: 1000, new: 100, churned: 100, closing: 1000 });
    expect(r.timeline[1]!.customers).toEqual({ opening: 1000, new: 100, churned: 100, closing: 1000 });
    expect(r.timeline[1]!.metrics.churnRate).toBe(0.1);
  });
  it("converts annual churn to an equivalent per-period rate", () => {
    const r = simulate(
      makeModel({ nodes: [{ id: "ch", type: "CHURN", label: "Churn", parameters: { rate: "r" }, config: { basis: "annual" } }], params: [{ id: "r", value: 0.2 }] }, { horizon: 1 }),
    );
    const monthly = r.timeline[0]!.nodes.ch!.out!;
    expect((1 - monthly) ** 12).toBeCloseTo(0.8, 12);
  });
});

describe("SPLIT", () => {
  it("routes the input across branches by weight", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "in", type: "INPUT", label: "New", parameters: { value: "v" } },
            {
              id: "s",
              type: "SPLIT",
              label: "Plans",
              parameters: { "weight.prime": "w1", "weight.studio": "w2", "weight.world": "w3" },
              config: { branches: [{ key: "prime", label: "Prime" }, { key: "studio", label: "Studio" }, { key: "world", label: "World" }] },
            },
          ],
          connections: [["in", "s", "input"]],
          params: [{ id: "v", value: 1000 }, { id: "w1", value: 0.78 }, { id: "w2", value: 0.17 }, { id: "w3", value: 0.05 }],
        },
        { horizon: 1 },
      ),
    );
    expect(r.timeline[0]!.nodes.s).toEqual({ prime: 780, studio: 170, world: 50 });
  });
});

describe("PRICE + REVENUE", () => {
  it("revenue = quantity × price after discount, bucketed by revenue type", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "p", type: "PRICE", label: "Price", parameters: { price: "pr", discount: "d" } },
            { id: "sub", type: "REVENUE", label: "Subs", parameters: { quantity: "q" } },
            { id: "use", type: "REVENUE", label: "Usage", parameters: { quantity: "u", price: "up" }, config: { revenueType: "usage" } },
          ],
          connections: [["p", "sub", "price"]],
          params: [{ id: "pr", value: 40 }, { id: "d", value: 0.25 }, { id: "q", value: 10 }, { id: "u", value: 1000 }, { id: "up", value: 0.02 }],
        },
        { horizon: 1 },
      ),
    );
    const p = r.timeline[0]!;
    expect(p.nodes.p!.out).toBe(30);
    expect(p.revenue).toEqual({ subscription: 300, usage: 20, topups: 0, other: 0, total: 320 });
    expect(p.metrics.mrr).toBe(300);
  });
  it("normalizes MRR for quarterly steps", () => {
    const r = simulate(
      makeModel({ nodes: [{ id: "s", type: "REVENUE", label: "Subs", parameters: { quantity: "q", price: "p" } }], params: [{ id: "q", value: 10 }, { id: "p", value: 300 }] }, { timeStep: "quarterly", horizon: 1 }),
    );
    expect(r.timeline[0]!.metrics.mrr).toBe(1000);
    expect(r.timeline[0]!.metrics.arr).toBe(12000);
  });
});

describe("COST", () => {
  const cost = (config: object, parameters: Record<string, string>, params: { id: string; value: number }[], horizon = 4) =>
    series(simulate(makeModel({ nodes: [{ id: "k", type: "COST", label: "Cost", parameters, config } as never], params }, { horizon })), "k");

  it("fixed", () => expect(cost({ costType: "fixed" }, { amount: "a" }, [{ id: "a", value: 20000 }], 2)).toEqual([20000, 20000]));
  it("fixed with growth", () => expect(cost({ costType: "fixed" }, { amount: "a", growth: "g" }, [{ id: "a", value: 1000 }, { id: "g", value: 0.1 }], 3)).toEqual([1000, 1100, 1210]));
  it("fixed within a start/end window (e.g. a hire in month 2)", () => {
    expect(cost({ costType: "fixed", startPeriod: 2, endPeriod: 3 }, { amount: "a" }, [{ id: "a", value: 500 }])).toEqual([0, 500, 500, 0]);
  });
  it("variable", () => expect(cost({ costType: "variable" }, { volume: "v", unitCost: "u" }, [{ id: "v", value: 56 }, { id: "u", value: 8 }], 1)).toEqual([448]));
  it("percentage (payment fees 2.9%)", () => expect(cost({ costType: "percentage" }, { base: "b", rate: "r" }, [{ id: "b", value: 10000 }, { id: "r", value: 0.029 }], 1)).toEqual([290]));
  it("step tiers", () => {
    const tiers = [{ upTo: 1000, cost: 500 }, { upTo: 5000, cost: 1000 }, { cost: 2000 }];
    const at = (v: number) => cost({ costType: "step", tiers }, { volume: "v" }, [{ id: "v", value: v }], 1)[0];
    expect(at(0)).toBe(500);
    expect(at(1000)).toBe(500);
    expect(at(1001)).toBe(1000);
    expect(at(99999)).toBe(2000);
  });
  it("step cost errors when volume exceeds bounded tiers", () => {
    const m = makeModel({ nodes: [{ id: "k", type: "COST", label: "Hosting", parameters: { volume: "v" }, config: { costType: "step", tiers: [{ upTo: 10, cost: 1 }] } }], params: [{ id: "v", value: 11 }] });
    expect(() => simulate(m)).toThrow(SimulationError);
    expect(() => simulate(m)).toThrow(/exceeds the highest tier/);
  });
  it("splits COGS and OpEx and tracks categories", () => {
    const r = simulate(
      makeModel({
        nodes: [
          { id: "a", type: "COST", label: "AI", parameters: { amount: "x" }, config: { costType: "fixed", costClass: "cogs", category: "ai" } },
          { id: "b", type: "COST", label: "Payroll", parameters: { amount: "y" }, config: { costType: "fixed", category: "payroll" } },
        ],
        params: [{ id: "x", value: 100 }, { id: "y", value: 900 }],
      }, { horizon: 1 }),
    );
    expect(r.timeline[0]!.costs).toEqual({ cogs: 100, opex: 900, byCategory: { ai: 100, payroll: 900 }, total: 1000 });
  });
});

describe("POOL", () => {
  it("accumulates and clamps to min/max, reporting overflow and shortfall", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [{ id: "w", type: "POOL", label: "Credits", parameters: { initial: "i", inflow: "in", outflow: "out", maximum: "max", minimum: "min" } }],
          params: [{ id: "i", value: 50 }, { id: "in", value: 100 }, { id: "out", value: 30 }, { id: "max", value: 150 }, { id: "min", value: 0 }],
        },
        { horizon: 3 },
      ),
    );
    expect(series(r, "w")).toEqual([120, 150, 150]);
    expect(series(r, "w", "overflow")).toEqual([0, 40, 70]);
    expect(series(r, "w", "opening")).toEqual([50, 120, 150]);
  });
  it("shortfall when outflow exceeds the balance", () => {
    const r = simulate(
      makeModel({ nodes: [{ id: "w", type: "POOL", label: "W", parameters: { initial: "i", outflow: "o", minimum: "m" } }], params: [{ id: "i", value: 10 }, { id: "o", value: 25 }, { id: "m", value: 0 }] }, { horizon: 1 }),
    );
    expect(r.timeline[0]!.nodes.w).toMatchObject({ out: 0, shortfall: 15 });
  });
});

describe("CASH", () => {
  it("goes negative and flags the cash-out period", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "cost", type: "COST", label: "Burn", parameters: { amount: "a" }, config: { costType: "fixed" } },
            { id: "cash", type: "CASH", label: "Cash", parameters: { initial: "c" } },
          ],
          connections: [["cost", "cash", "outflow"]],
          params: [{ id: "a", value: 40 }, { id: "c", value: 100 }],
        },
        { horizon: 4 },
      ),
    );
    expect(series(r, "cash")).toEqual([60, 20, -20, -60]);
    expect(r.summary.cashOutPeriod).toBe(3);
    expect(r.events.find((e) => e.type === "cash_negative")).toMatchObject({ period: 3, severity: "critical", message: "Cash runs out in 2027-03." });
    expect(r.timeline[0]!.metrics.runwayMonths).toBe(1.5);
    expect(r.timeline[2]!.metrics.runwayMonths).toBe(0);
  });
  it("without a cash node, cash and runway are null rather than fake zeros", () => {
    const r = simulate(makeModel({ nodes: [{ id: "k", type: "COST", label: "K", parameters: { amount: "a" }, config: { costType: "fixed" } }], params: [{ id: "a", value: 5 }] }, { horizon: 1 }));
    expect(r.summary.cash).toBeNull();
    expect(r.summary.runwayMonths).toBeNull();
    expect(r.timeline[0]!.metrics.cash).toBeNull();
    expect(r.timeline[0]!.metrics.burn).toBe(5);
  });
});

describe("CAPACITY", () => {
  it("serves up to capacity and records exceeded events", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "d", type: "GROWTH", label: "Accounts", parameters: { base: "b", rate: "r" } },
            { id: "cap", type: "CAPACITY", label: "Guardian capacity", parameters: { capacity: "c" } },
          ],
          connections: [["d", "cap", "demand"]],
          params: [{ id: "b", value: 100 }, { id: "r", value: 0.1 }, { id: "c", value: 120 }],
        },
        { horizon: 3 },
      ),
    );
    expect(series(r, "cap")).toEqual([100, 110, 120]);
    expect(series(r, "cap", "excess")).toEqual([0, 0, 1]);
    expect(r.events.filter((e) => e.type === "capacity_exceeded").map((e) => e.period)).toEqual([3]);
  });
});

describe("CONDITION", () => {
  it("switches output and emits labelled events", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "g", type: "GROWTH", label: "Load", parameters: { base: "b", rate: "r" } },
            { id: "cond", type: "CONDITION", label: "High load", parameters: { threshold: "t", then: "hi", else: "lo" }, config: { operator: ">", eventLabel: "Load above 110" } },
          ],
          connections: [["g", "cond", "value"]],
          params: [{ id: "b", value: 100 }, { id: "r", value: 0.1 }, { id: "t", value: 110 }, { id: "hi", value: 0.08 }, { id: "lo", value: 0.05 }],
        },
        { horizon: 3 },
      ),
    );
    expect(series(r, "cond")).toEqual([0.05, 0.05, 0.08]);
    expect(series(r, "cond", "active")).toEqual([0, 0, 1]);
    expect(r.events.filter((e) => e.type === "condition")).toEqual([{ period: 3, type: "condition", severity: "info", message: "Load above 110", nodeId: "cond" }]);
  });
});

describe("FORMULA", () => {
  it("evaluates with wired and parameter variables", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "c", type: "INPUT", label: "Customers", parameters: { value: "cv" } },
            { id: "f", type: "FORMULA", label: "Revenue", parameters: { arpu: "a" }, config: { expression: "customers * arpu" } },
          ],
          connections: [["c", "f", "customers"]],
          params: [{ id: "cv", value: 100 }, { id: "a", value: 39 }],
        },
        { horizon: 1 },
      ),
    );
    expect(r.timeline[0]!.nodes.f!.out).toBe(3900);
  });
  it("supports period and previous() of a variable", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "g", type: "GROWTH", label: "Users", parameters: { base: "b", rate: "r" } },
            { id: "f", type: "FORMULA", label: "Net adds", config: { expression: "if(period > 1, users - previous(users), 0)" } },
          ],
          connections: [["g", "f", "users"]],
          params: [{ id: "b", value: 100 }, { id: "r", value: 0.1 }],
        },
        { horizon: 3 },
      ),
    );
    expect(series(r, "f")).toEqual([0, 10, 11]);
  });
  it("reports runtime formula errors with node and period", () => {
    // users: 2, 0 (absolute growth of −2) → x / users divides by zero in period 2
    const m = makeModel(
      {
        nodes: [
          { id: "g", type: "GROWTH", label: "Users", parameters: { base: "b", rate: "r" }, config: { growthType: "absolute" } },
          { id: "f", type: "FORMULA", label: "Ratio", parameters: { x: "x" }, config: { expression: "x / users" } },
        ],
        connections: [["g", "f", "users"]],
        params: [{ id: "b", value: 2 }, { id: "r", value: -2 }, { id: "x", value: 1 }],
      },
      { horizon: 2 },
    );
    try {
      simulate(m);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SimulationError);
      expect((e as SimulationError).message).toBe("Ratio: Division by zero.");
      expect((e as SimulationError).period).toBe(2);
      expect((e as SimulationError).nodeId).toBe("f");
    }
  });
});

describe("FLOW", () => {
  it("sums inputs and applies the multiplier", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "a", type: "INPUT", label: "A", parameters: { value: "x" } },
            { id: "b", type: "INPUT", label: "B", parameters: { value: "y" } },
            { id: "f", type: "FLOW", label: "Credits burned", parameters: { multiplier: "m" } },
          ],
          connections: [["a", "f", "amount"], ["b", "f", "amount"]],
          params: [{ id: "x", value: 10 }, { id: "y", value: 5 }, { id: "m", value: 3 }],
        },
        { horizon: 1 },
      ),
    );
    expect(r.timeline[0]!.nodes.f!.out).toBe(45);
  });
});

describe("upgrades between plans (CUSTOMERS moved-out)", () => {
  it("moves customers from one plan to another without counting them as new", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "basic", type: "CUSTOMERS", label: "Basic", parameters: { initial: "b0" } },
            { id: "pro", type: "CUSTOMERS", label: "Pro", parameters: { initial: "p0" } },
            { id: "up", type: "CONVERSION", label: "Upgrade", parameters: { rate: "u" } },
          ],
          connections: [
            ["basic", "up", "input", "opening"],
            ["up", "pro", "new"],
            ["up", "basic", "moved"],
          ],
          params: [{ id: "b0", value: 1000 }, { id: "p0", value: 100 }, { id: "u", value: 0.1 }],
        },
        { horizon: 2 },
      ),
    );
    expect(series(r, "basic")).toEqual([900, 810]);
    expect(series(r, "pro")).toEqual([200, 290]);
    expect(r.timeline[0]!.customers).toEqual({ opening: 1100, new: 0, churned: 0, closing: 1100 });
  });
});

describe("guardrail events", () => {
  it("records an event for every violating period", () => {
    const m = makeModel(
      {
        nodes: [
          { id: "cost", type: "COST", label: "Burn", parameters: { amount: "a" }, config: { costType: "fixed" } },
          { id: "cash", type: "CASH", label: "Cash", parameters: { initial: "c" } },
        ],
        connections: [["cost", "cash", "outflow"]],
        params: [{ id: "a", value: 40 }, { id: "c", value: 100 }],
      },
      { horizon: 3 },
    );
    m.guardrails = [{ id: "g", label: "Runway > 1 month", metric: "runwayMonths", operator: ">", threshold: 1 }];
    const r = simulate(m);
    const events = r.events.filter((e) => e.type === "guardrail");
    expect(events.map((e) => e.period)).toEqual([2, 3]);
    expect(events[0]!.message).toBe('Guardrail "Runway > 1 month" not met (0.5 months).');
  });
});
