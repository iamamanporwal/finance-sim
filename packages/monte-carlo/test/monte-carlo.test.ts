import { acceptanceModel, type ModelInput } from "@fin/model-schema";
import { createRng, simulate } from "@fin/simulation-engine";
import { describe as suite, expect, it } from "vitest";
import { describe, histogram, MonteCarloRun, percentile, rescaleDistribution, runMonteCarlo, sample } from "../src";

const draws = (d: Parameters<typeof sample>[0], n = 20000, center = 0) => {
  const rng = createRng(123);
  return Array.from({ length: n }, () => sample(d, center, rng));
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

suite("distribution sampling", () => {
  it("fixed returns the value", () => expect(draws({ type: "fixed" }, 10, 7)).toEqual(Array(10).fill(7)));
  it("uniform stays in range with the right mean", () => {
    const xs = draws({ type: "uniform", min: 0.1, max: 0.3 });
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...xs)).toBeLessThan(0.3);
    expect(mean(xs)).toBeCloseTo(0.2, 2);
  });
  it("normal has the right mean and standard deviation", () => {
    const xs = draws({ type: "normal", mean: 10, stdDev: 2 });
    expect(mean(xs)).toBeCloseTo(10, 1);
    expect(sd(xs)).toBeCloseTo(2, 1);
  });
  it("triangular mean is (a + b + c) / 3", () => {
    const xs = draws({ type: "triangular", min: 3, mode: 5, max: 10 });
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...xs)).toBeLessThanOrEqual(10);
    expect(mean(xs)).toBeCloseTo(6, 1);
  });
  it("log-normal matches its mean and standard deviation and stays positive", () => {
    const xs = draws({ type: "lognormal", mean: 100, stdDev: 20 });
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(mean(xs) / 100).toBeCloseTo(1, 1);
    expect(sd(xs) / 20).toBeCloseTo(1, 1);
  });
  it("discrete respects weights", () => {
    const xs = draws({ type: "discrete", outcomes: [{ value: 1, weight: 3 }, { value: 2, weight: 1 }] });
    expect(xs.filter((x) => x === 1).length / xs.length).toBeCloseTo(0.75, 1);
  });
  it("is deterministic for a seed", () => {
    expect(draws({ type: "normal", mean: 0, stdDev: 1 }, 50)).toEqual(draws({ type: "normal", mean: 0, stdDev: 1 }, 50));
  });
  it("rescales a distribution when a scenario changes the value", () => {
    expect(rescaleDistribution({ type: "triangular", min: 0.1, mode: 0.2, max: 0.3 }, 0.2, 0.1)).toEqual({ type: "triangular", min: 0.05, mode: 0.1, max: 0.15 });
  });
});

suite("statistics", () => {
  it("percentiles interpolate between ranks", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 0.5)).toBe(5.5);
    expect(percentile(xs, 0.1)).toBeCloseTo(1.9, 10);
    expect(percentile(xs, 0.9)).toBeCloseTo(9.1, 10);
  });
  it("describe returns every statistic, and null for no data", () => {
    expect(describe([3, 1, 2])).toEqual({ count: 3, mean: 2, min: 1, max: 3, p10: 1.2, p25: 1.5, p50: 2, p75: 2.5, p90: 2.8 });
    expect(describe([])).toBeNull();
    expect(describe([Number.NaN])).toBeNull();
  });
  it("histogram counts every value", () => {
    const bins = histogram([1, 2, 2, 3, 10], 3);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(5);
    expect(bins[0]!.from).toBe(1);
    expect(bins[2]!.to).toBe(10);
  });
});

/** PRD acceptance test: uncertainty around growth, conversion, churn and COGS; 1,000 runs. */
function uncertainModel(): ModelInput {
  const m = acceptanceModel();
  const tri = (id: string, min: number, mode: number, max: number) => {
    m.parameters!.find((p) => p.id === id)!.distribution = { type: "triangular", min, mode, max };
  };
  tri("p_growth", 0.1, 0.2, 0.3);
  tri("p_conversion", 0.05, 0.07, 0.09);
  tri("p_churn", 0.03, 0.05, 0.07);
  tri("p_cogs", 6, 8, 12);
  return m;
}

suite("Monte Carlo", () => {
  const base = simulate(acceptanceModel());
  const r = runMonteCarlo(uncertainModel(), { runs: 1000, seed: 7, targetMrr: base.summary.mrr, targetCash: 1_000_000 });

  it("completes 1,000 runs with the uncertain assumptions", () => {
    expect(r.completed).toBe(1000);
    expect(r.failed).toBe(0);
    expect(r.uncertainParameters.map((p) => p.id).sort()).toEqual(["p_churn", "p_cogs", "p_conversion", "p_growth"]);
  });
  it("reports ordered percentiles", () => {
    const m = r.metrics.mrr!;
    expect(m.min).toBeLessThanOrEqual(m.p10);
    expect(m.p10).toBeLessThan(m.p25);
    expect(m.p25).toBeLessThan(m.p50);
    expect(m.p50).toBeLessThan(m.p75);
    expect(m.p75).toBeLessThan(m.p90);
    expect(m.p90).toBeLessThanOrEqual(m.max);
    // Symmetric inputs around the base → median close to the base case.
    expect(m.p50 / base.summary.mrr).toBeGreaterThan(0.6);
    expect(m.p50 / base.summary.mrr).toBeLessThan(1.4);
  });
  it("computes probabilities from the runs", () => {
    expect(r.probabilities.profitability).toBeGreaterThan(0.5);
    expect(r.probabilities.cashOut).toBeGreaterThanOrEqual(0);
    expect(r.probabilities.targetMrr).toBeGreaterThan(0);
    expect(r.probabilities.targetMrr).toBeLessThan(1);
    expect(r.probabilities.guardrailViolation).not.toBeNull();
  });
  it("produces histograms and per-period bands", () => {
    expect(r.histograms.mrr.reduce((a, b) => a + b.count, 0)).toBe(1000);
    expect(r.bands.mrr).toHaveLength(24);
    for (const b of r.bands.mrr) {
      expect(b.p10).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
    }
    expect(r.periodLabels[23]).toBe("2028-12");
  });
  it("is reproducible: same seed → identical statistics", () => {
    const again = runMonteCarlo(uncertainModel(), { runs: 1000, seed: 7, targetMrr: base.summary.mrr, targetCash: 1_000_000 });
    expect({ ...again, durationMs: 0 }).toEqual({ ...r, durationMs: 0 });
  });
  it("chunked execution gives the same result as a single pass", () => {
    const run = new MonteCarloRun(uncertainModel(), { runs: 200, seed: 3 });
    const sizes = [1, 7, 50, 142];
    for (const s of sizes) run.step(s);
    expect(run.done).toBe(true);
    expect({ ...run.result(), durationMs: 0 }).toEqual({ ...runMonteCarlo(uncertainModel(), { runs: 200, seed: 3 }), durationMs: 0 });
  });
  it("a different seed gives different samples", () => {
    expect(runMonteCarlo(uncertainModel(), { runs: 200, seed: 8 }).metrics.mrr!.p50).not.toBe(runMonteCarlo(uncertainModel(), { runs: 200, seed: 3 }).metrics.mrr!.p50);
  });
  it("without uncertainty every run equals the deterministic result", () => {
    const flat = runMonteCarlo(acceptanceModel(), { runs: 20 });
    expect(flat.uncertainParameters).toEqual([]);
    expect(flat.metrics.mrr!.p10).toBe(base.summary.mrr);
    expect(flat.metrics.mrr!.p90).toBe(base.summary.mrr);
  });
  it("clamps samples to valid ranges so runs never become invalid", () => {
    const m = acceptanceModel();
    m.parameters!.find((p) => p.id === "p_churn")!.distribution = { type: "normal", mean: 0.05, stdDev: 0.5 };
    const res = runMonteCarlo(m, { runs: 300, seed: 1 });
    expect(res.failed).toBe(0);
  });
  it("uses scenario values as the center", () => {
    const m = uncertainModel();
    const slow = runMonteCarlo(m, { runs: 300, seed: 1, scenarioId: "slow" });
    const baseRuns = runMonteCarlo(m, { runs: 300, seed: 1 });
    expect(slow.metrics.mrr!.p50).toBeLessThan(baseRuns.metrics.mrr!.p50);
    expect(slow.uncertainParameters.find((p) => p.id === "p_growth")!.distribution).toEqual({ type: "triangular", min: 0.05, mode: 0.1, max: 0.15 });
  });
  it("rejects invalid run counts", () => {
    expect(() => new MonteCarloRun(acceptanceModel(), { runs: 0 })).toThrow(/Runs must be/);
  });
});
