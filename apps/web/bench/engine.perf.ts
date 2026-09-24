/**
 * Engine performance measurements (Phase 30). Run with `pnpm perf`.
 * Prints median timings; asserts only generous budgets so it stays stable on slow machines.
 */
import { acceptanceModel, parseModel, type Model } from "@fin/model-schema";
import { MonteCarloRun } from "@fin/monte-carlo";
import { explainWhy, runSensitivity, simulate, Simulator, validateForSimulation } from "@fin/simulation-engine";
import { instantiateTemplate } from "@fin/templates";
import { describe, expect, it } from "vitest";
import { applyDefaultUncertainty } from "@/lib/uncertainty";

function time(fn: () => unknown, repeat = 15): number {
  fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < repeat; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

const models: [string, Model][] = [
  ["acceptance (10 nodes, 24 mo)", parseModel(acceptanceModel())],
  ["HERE (41 nodes, 36 mo)", instantiateTemplate("here", "m_here")],
];
const rows: Record<string, string>[] = [];
const ms = (v: number) => `${v < 10 ? v.toFixed(2) : v.toFixed(0)} ms`;

describe("engine performance", () => {
  for (const [name, model] of models) {
    it(name, () => {
      const validate = time(() => validateForSimulation(model));
      const single = time(() => simulate(model));
      const sim = new Simulator(model);
      sim.run();
      const param = model.parameters.find((p) => /price/i.test(p.name))!;
      let v = param.value;
      const update = time(() => {
        v = v === param.value ? param.value * 1.1 : param.value;
        sim.setParameter(param.id, v).recalculate();
      });
      const result = simulate(model);
      const why = time(() => explainWhy(model, result, { metric: "mrr" }));
      const sens = time(() => runSensitivity(model, { metric: "mrr" }), 3);
      const mcModel = applyDefaultUncertainty(model);
      const mc = (runs: number) => {
        const t = performance.now();
        const run = new MonteCarloRun(mcModel, { runs, seed: 1 });
        while (!run.done) run.step(100);
        run.result();
        return performance.now() - t;
      };
      const mc1k = mc(1000);
      const mc10k = mc(10000);
      rows.push({ model: name, validate: ms(validate), "single run": ms(single), "model update": ms(update), "why?": ms(why), sensitivity: ms(sens), "MC 1,000": ms(mc1k), "MC 10,000": ms(mc10k) });
      // Interactive budgets from the plan: a single run and an edit must feel instant.
      expect(single).toBeLessThan(200);
      expect(update).toBeLessThan(200);
      expect(mc10k).toBeLessThan(120_000);
    }, 300_000);
  }
  it("report", () => {
    console.table(rows);
  });
});
