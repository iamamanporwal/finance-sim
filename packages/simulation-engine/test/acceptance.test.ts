import { Decimal } from "@fin/formula-engine";
import { acceptanceModel, SimulationResultSchema } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import { simulate, Simulator } from "../src";

/**
 * Plan Phase 4 acceptance test:
 *   Signups 800/month, growth 20%, conversion 7%, price $39, churn 5%,
 *   COGS $8/customer, fixed costs $20,000/month, starting cash $500,000, 24 months.
 */
describe("acceptance model — manual verification of months 1-3", () => {
  const result = simulate(acceptanceModel());
  const [m1, m2, m3] = result.timeline;

  it("produces a complete 24-month timeline", () => {
    expect(result.timeline).toHaveLength(24);
    expect(result.timeline[0]!.period).toBe("2027-01");
    expect(result.timeline[23]!.period).toBe("2028-12");
  });

  it("month 1", () => {
    // signups 800 · new = 800 × 7% = 56 · churned = 0 × 5% = 0 · customers = 56
    expect(m1!.nodes.growth!.out).toBe(800);
    expect(m1!.customers).toEqual({ opening: 0, new: 56, churned: 0, closing: 56 });
    // revenue = 56 × $39 = $2,184 · COGS = 56 × $8 = $448 · gross profit = $1,736
    expect(m1!.revenue.total).toBe(2184);
    expect(m1!.costs.cogs).toBe(448);
    expect(m1!.costs.opex).toBe(20000);
    expect(m1!.profit.grossProfit).toBe(1736);
    expect(m1!.profit.grossMargin).toBeCloseTo(1736 / 2184, 12);
    // operating profit = 2,184 − 448 − 20,000 = −18,264 · cash = 500,000 − 18,264 = 481,736
    expect(m1!.profit.operatingProfit).toBe(-18264);
    expect(m1!.cash).toEqual({ opening: 500000, inflow: 2184, outflow: 20448, closing: 481736 });
  });

  it("month 2", () => {
    // signups 960 · new 67.2 · churned = 56 × 5% = 2.8 · customers = 56 + 67.2 − 2.8 = 120.4
    expect(m2!.nodes.growth!.out).toBe(960);
    expect(m2!.customers).toEqual({ opening: 56, new: 67.2, churned: 2.8, closing: 120.4 });
    // revenue = 120.4 × 39 = 4,695.6 · COGS = 963.2 · gross profit = 3,732.4
    expect(m2!.revenue.total).toBe(4695.6);
    expect(m2!.costs.cogs).toBe(963.2);
    expect(m2!.profit.grossProfit).toBe(3732.4);
    // operating profit = −16,267.6 · cash = 481,736 − 16,267.6 = 465,468.4
    expect(m2!.profit.operatingProfit).toBe(-16267.6);
    expect(m2!.cash.closing).toBe(465468.4);
  });

  it("month 3", () => {
    // signups 1,152 · new 80.64 · churned = 120.4 × 5% = 6.02 · customers = 195.02
    expect(m3!.nodes.growth!.out).toBe(1152);
    expect(m3!.customers).toEqual({ opening: 120.4, new: 80.64, churned: 6.02, closing: 195.02 });
    // revenue = 195.02 × 39 = 7,605.78 · COGS = 1,560.16 · gross profit = 6,045.62
    expect(m3!.revenue.total).toBe(7605.78);
    expect(m3!.costs.cogs).toBe(1560.16);
    expect(m3!.profit.grossProfit).toBe(6045.62);
    // operating profit = −13,954.38 · cash = 451,514.02 · burn 13,954.38
    expect(m3!.profit.operatingProfit).toBe(-13954.38);
    expect(m3!.cash.closing).toBe(451514.02);
    expect(m3!.metrics.burn).toBe(13954.38);
    expect(m3!.metrics.runwayMonths).toBeCloseTo(451514.02 / 13954.38, 10);
    expect(m3!.metrics.mrr).toBe(7605.78);
    expect(m3!.metrics.arr).toBe(7605.78 * 12);
  });

  it("matches an independent Decimal re-implementation for all 24 months", () => {
    let customers = new Decimal(0);
    let cash = new Decimal(500000);
    for (let t = 1; t <= 24; t++) {
      const signups = new Decimal(800).times(new Decimal(1.2).pow(t - 1));
      const churned = customers.times(0.05);
      customers = customers.plus(signups.times(0.07)).minus(churned);
      const revenue = customers.times(39);
      const cogs = customers.times(8);
      cash = cash.plus(revenue).minus(cogs).minus(20000);
      const p = result.timeline[t - 1]!;
      expect(p.customers.closing, `customers m${t}`).toBe(customers.toNumber());
      expect(p.revenue.total, `revenue m${t}`).toBe(revenue.toNumber());
      expect(p.costs.total, `costs m${t}`).toBe(cogs.plus(20000).toNumber());
      expect(p.profit.grossProfit, `gross profit m${t}`).toBe(revenue.minus(cogs).toNumber());
      expect(p.cash.closing, `cash m${t}`).toBe(cash.toNumber());
    }
  });

  it("reports break-even, summary and events from engine data", () => {
    const be = result.timeline.find((p) => p.profit.operatingProfit >= 0)!;
    expect(result.summary.breakEvenPeriod).toBe(be.index);
    expect(result.events.find((e) => e.type === "break_even")?.period).toBe(be.index);
    const last = result.timeline[23]!;
    expect(result.summary).toMatchObject({
      mrr: last.metrics.mrr,
      arr: last.metrics.arr,
      customers: last.customers.closing,
      cash: last.cash.closing,
      cashOutPeriod: null,
    });
  });

  it("evaluates guardrails every period", () => {
    const cash = result.guardrails.find((g) => g.guardrailId === "g_cash")!;
    expect(cash.passed).toBe(true);
    const margin = result.guardrails.find((g) => g.guardrailId === "g_margin")!;
    // Gross margin is (39 − 8) / 39 ≈ 79.5% every period.
    expect(margin.passed).toBe(true);
  });

  it("never emits NaN or Infinity and matches the result schema", () => {
    expect(() => SimulationResultSchema.parse(result)).not.toThrow();
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/NaN|Infinity/);
  });
});

describe("determinism", () => {
  it("same model + parameters + seed → identical results", () => {
    const a = simulate(acceptanceModel());
    const b = simulate(JSON.parse(JSON.stringify(acceptanceModel())));
    expect(b).toEqual(a);
  });
  it("records the seed and a reproducible run ID", () => {
    const r = simulate(acceptanceModel(), { seed: 928173 });
    expect(r.seed).toBe(928173);
    expect(r.settings.seed).toBe(928173);
    expect(r.runId).toBe("acceptance-v1-base-s928173");
  });
});

describe("scenario: growth 20% → 10%", () => {
  it("applies the override without modifying the base model", () => {
    const model = acceptanceModel();
    const base = simulate(model);
    const slow = simulate(model, { scenarioId: "slow" });
    expect(slow.timeline[1]!.nodes.growth!.out).toBe(880);
    expect(slow.summary.mrr).toBeLessThan(base.summary.mrr);
    expect(slow.summary.cash!).toBeLessThan(base.summary.cash!);
    expect(model.parameters!.find((p) => p.id === "p_growth")!.value).toBe(0.2);
  });
  it("gives the same result as editing the assumption directly", () => {
    const viaScenario = simulate(acceptanceModel(), { scenarioId: "slow" });
    const viaOverride = simulate(acceptanceModel(), { parameterOverrides: { p_growth: 0.1 } });
    expect(viaOverride.timeline).toEqual(viaScenario.timeline);
  });
  it("rejects unknown scenarios", () => {
    expect(() => new Simulator(acceptanceModel(), { scenarioId: "nope" })).toThrow(/Unknown scenario/);
  });
});

describe("performance", () => {
  it("runs a simple 24-month simulation in well under 100ms", () => {
    simulate(acceptanceModel()); // warm up
    const start = performance.now();
    for (let i = 0; i < 20; i++) simulate(acceptanceModel());
    const perRun = (performance.now() - start) / 20;
    expect(perRun).toBeLessThan(100);
  });
});
