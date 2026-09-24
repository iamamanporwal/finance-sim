import { acceptanceModel, parseModel } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import {
  compareScenarios,
  explainGuardrail,
  explainMetric,
  generateScenarioOverrides,
  parameterBounds,
  runSensitivity,
  simulate,
  Simulator,
} from "../src";
import { makeModel } from "./helpers";

describe("Simulator.runWith (fast path)", () => {
  it("matches a validated run with the same overrides and restores state", () => {
    const sim = new Simulator(acceptanceModel());
    const base = sim.run();
    const fast = sim.runWith({ p_price: 49 });
    expect(fast.timeline).toEqual(simulate(acceptanceModel(), { parameterOverrides: { p_price: 49 } }).timeline);
    expect(sim.recalculate().result.timeline).toEqual(base.timeline);
  });
  it("can skip per-node values for speed", () => {
    const r = new Simulator(acceptanceModel()).runWith({}, { includeNodeValues: false });
    expect(r.timeline[0]!.nodes).toEqual({});
    expect(r.timeline[0]!.revenue.total).toBe(2184);
  });
});

describe("parameterBounds", () => {
  it("combines parameter limits with slot ranges", () => {
    const b = parameterBounds(parseModel(acceptanceModel()));
    expect(b.get("p_conversion")).toEqual({ min: 0, max: 1 });
    expect(b.get("p_growth")).toEqual({ min: 0, max: 1 });
    expect(b.get("p_price")).toEqual({ min: 0, max: undefined });
  });
});

describe("sensitivity analysis", () => {
  const r = runSensitivity(acceptanceModel(), { metric: "mrr" });

  it("ranks growth as the biggest driver of month-24 MRR", () => {
    expect(r.period).toBe(24);
    expect(r.entries[0]!.parameterId).toBe("p_growth");
  });
  it("uses real runs: price ±10% moves MRR exactly ±10%", () => {
    const price = r.entries.find((e) => e.parameterId === "p_price")!;
    expect(price.lowValue).toBeCloseTo(35.1, 10);
    expect(price.highValue).toBeCloseTo(42.9, 10);
    expect(price.lowResult! / r.baseResult!).toBeCloseTo(0.9, 10);
    expect(price.highResult! / r.baseResult!).toBeCloseTo(1.1, 10);
    expect(price.direction).toBe("up");
  });
  it("churn lowers MRR", () => {
    expect(r.entries.find((e) => e.parameterId === "p_churn")!.direction).toBe("down");
  });
  it("assumptions that cannot affect MRR have zero impact", () => {
    for (const id of ["p_cogs", "p_fixed", "p_cash"]) {
      const e = r.entries.find((x) => x.parameterId === id)!;
      expect(e.impact).toBe(0);
      expect(e.direction).toBe("none");
    }
  });
  it("for cash, fixed costs and COGS matter", () => {
    const cash = runSensitivity(acceptanceModel(), { metric: "cash", delta: 0.2 });
    expect(cash.entries.find((e) => e.parameterId === "p_fixed")!.direction).toBe("down");
    expect(cash.entries.find((e) => e.parameterId === "p_cash")!.direction).toBe("up");
  });
  it("clamps to valid ranges", () => {
    const m = acceptanceModel();
    m.parameters!.find((p) => p.id === "p_conversion")!.value = 0.95;
    const e = runSensitivity(m, { metric: "mrr", delta: 0.2 }).entries.find((x) => x.parameterId === "p_conversion")!;
    expect(e.highValue).toBe(1);
  });
  it("is deterministic", () => {
    expect(runSensitivity(acceptanceModel(), { metric: "mrr" })).toEqual(r);
  });
});

describe("scenarios", () => {
  it("compares base and scenarios with engine summaries", () => {
    const rows = compareScenarios(acceptanceModel(), [null, "base", "slow"]);
    expect(rows.map((r) => r.name)).toEqual(["Base model", "Base", "Slow growth"]);
    expect(rows[0]!.summary!.mrr).toBe(rows[1]!.summary!.mrr);
    expect(rows[2]!.summary!.mrr).toBeLessThan(rows[0]!.summary!.mrr);
    expect(rows[0]!.minCash).toBeLessThan(500000);
  });
  it("generates upside and downside overrides in favorable/unfavorable directions", () => {
    const up = new Map(generateScenarioOverrides(acceptanceModel(), "upside").map((o) => [o.parameterId, o.value]));
    const down = new Map(generateScenarioOverrides(acceptanceModel(), "downside").map((o) => [o.parameterId, o.value]));
    expect(up.get("p_growth")).toBeCloseTo(0.24, 10);
    expect(up.get("p_churn")).toBeCloseTo(0.04, 10);
    expect(up.get("p_fixed")).toBeCloseTo(16000, 6);
    expect(down.get("p_growth")).toBeCloseTo(0.16, 10);
    expect(down.get("p_churn")).toBeCloseTo(0.06, 10);
    const m = acceptanceModel();
    m.scenarios = [
      { id: "up", name: "Upside", kind: "upside", overrides: [...up].map(([parameterId, value]) => ({ parameterId, value })) },
      { id: "down", name: "Downside", kind: "downside", overrides: [...down].map(([parameterId, value]) => ({ parameterId, value })) },
    ];
    const [base, u, d] = compareScenarios(m, [null, "up", "down"]);
    expect(u!.summary!.cash!).toBeGreaterThan(base!.summary!.cash!);
    expect(d!.summary!.cash!).toBeLessThan(base!.summary!.cash!);
  });
});

describe("explanations (engine data only)", () => {
  it("explains a gross margin guardrail breach with the cost that grew", () => {
    const m = makeModel(
      {
        nodes: [
          { id: "rev", type: "REVENUE", label: "Revenue", parameters: { quantity: "q", price: "p" } },
          { id: "ai", type: "GROWTH", label: "AI cost", parameters: { base: "a", rate: "g" } },
          { id: "cogs", type: "COST", label: "AI tokens", config: { costType: "fixed", costClass: "cogs", category: "ai" } },
        ],
        connections: [["ai", "cogs", "amount"]],
        params: [{ id: "q", value: 100 }, { id: "p", value: 10 }, { id: "a", value: 300 }, { id: "g", value: 0.5 }],
      },
      { horizon: 3 },
    );
    m.guardrails = [{ id: "gm", label: "Gross margin > 55%", metric: "grossMargin", operator: ">", threshold: 0.55 }];
    const r = simulate(m);
    expect(r.guardrails[0]!.violations).toEqual([2, 3]);
    const e = explainGuardrail(parseModel(m), r, "gm", 2);
    expect(e.headline).toBe("Gross margin fell below 55.0% in 2027-02 (55.0%).");
    expect(e.referencePeriod).toBe(1);
    expect(e.cause).toMatch(/COGS grew faster than revenue since 2027-01: COGS up 50\.0% \(\$300 → \$450\) while revenue was unchanged/);
    expect(e.details[0]).toBe("Largest COGS increase: AI tokens ($300 → $450).");
  });

  it("traces MRR back through its drivers", () => {
    const model = parseModel(acceptanceModel());
    const e = explainMetric(model, simulate(model), "mrr", 3);
    expect(e.value).toBe(7605.78);
    expect(e.components).toEqual([{ label: "Subscription revenue", value: 7605.78 }]);
    expect(e.drivers.map((d) => d.label)).toEqual(["Customers", "Price", "Conversion", "Churn", "Signup growth", "Signups"]);
    expect(e.drivers.find((d) => d.label === "Customers")!.value).toBe(195.02);
  });
});

describe("CAC metrics", () => {
  it("computes CAC and payback from marketing spend", () => {
    const r = simulate(
      makeModel(
        {
          nodes: [
            { id: "acq", type: "ACQUISITION", label: "Ads", parameters: { budget: "b", cac: "c" } },
            { id: "cust", type: "CUSTOMERS", label: "Customers" },
            { id: "rev", type: "REVENUE", label: "Revenue", parameters: { price: "p" } },
          ],
          connections: [["acq", "cust", "new"], ["cust", "rev", "quantity"]],
          params: [{ id: "b", value: 1000 }, { id: "c", value: 100 }, { id: "p", value: 50 }],
        },
        { horizon: 1 },
      ),
    );
    expect(r.timeline[0]!.metrics.cac).toBe(100);
    // payback = 100 / (50 × 100% margin) = 2 months
    expect(r.timeline[0]!.metrics.cacPaybackMonths).toBe(2);
  });
});
