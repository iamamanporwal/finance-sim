import type { Distribution, Model } from "@fin/model-schema";
import { createRng, deriveSeed, parameterBounds, clamp, resolveParameterValues, Simulator } from "@fin/simulation-engine";
import { rescaleDistribution, sample } from "./distributions";
import { describe, fraction, histogram, type HistogramBin, type Statistics } from "./stats";

export const RUN_COUNT_OPTIONS = [100, 500, 1000, 5000, 10000] as const;

export interface MonteCarloOptions {
  runs: number;
  /** Base seed. Run i uses deriveSeed(seed, i), so results are reproducible and order-independent. */
  seed?: number;
  scenarioId?: string;
  /** Probability of final MRR ≥ target. */
  targetMrr?: number;
  /** Probability of final cash ≥ target. */
  targetCash?: number;
}

export interface UncertainParameter {
  id: string;
  name: string;
  unit: string;
  value: number;
  distribution: Distribution;
}

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}

export interface MonteCarloResult {
  runs: number;
  completed: number;
  failed: number;
  /** First few failure messages (a sample can push a run into an invalid state). */
  failures: string[];
  seed: number;
  scenarioId: string | null;
  horizon: number;
  periodLabels: string[];
  uncertainParameters: UncertainParameter[];
  metrics: {
    mrr: Statistics | null;
    arr: Statistics | null;
    customers: Statistics | null;
    cash: Statistics | null;
    minCash: Statistics | null;
    breakEvenPeriod: Statistics | null;
  };
  probabilities: {
    /** Operating profit ≥ 0 in the final period. */
    profitability: number;
    /** Cash below zero in any period (only when the model has cash). */
    cashOut: number | null;
    targetMrr: number | null;
    targetCash: number | null;
    /** Any enabled guardrail violated in any period. */
    guardrailViolation: number | null;
  };
  targets: { mrr: number | null; cash: number | null };
  histograms: { mrr: HistogramBin[]; cash: HistogramBin[] };
  bands: { mrr: Band[]; cash: Band[] };
  durationMs: number;
}

interface Sample {
  mrr: number;
  arr: number;
  customers: number;
  cash: number | null;
  minCash: number | null;
  breakEven: number | null;
  profitable: boolean;
  cashOut: boolean;
  guardrailViolated: boolean;
  mrrSeries: number[];
  cashSeries: number[] | null;
}

export function uncertainParameters(model: Model, scenarioId?: string): UncertainParameter[] {
  const base = resolveParameterValues(model, scenarioId);
  const scenarioDist = new Map<string, Distribution>();
  if (scenarioId) {
    const byId = new Map(model.scenarios.map((s) => [s.id, s]));
    const chain = [];
    for (let s = byId.get(scenarioId); s; s = s.parentId ? byId.get(s.parentId) : undefined) chain.unshift(s);
    for (const s of chain) for (const o of s.overrides) if (o.distribution) scenarioDist.set(o.parameterId, o.distribution);
  }
  const used = new Set(model.nodes.flatMap((n) => Object.values(n.parameters)));
  return model.parameters.flatMap((p) => {
    if (!used.has(p.id)) return [];
    const value = base.get(p.id)!.toNumber();
    const d = scenarioDist.get(p.id) ?? rescaleDistribution(p.distribution, p.value, value);
    if (!d || d.type === "fixed") return [];
    return [{ id: p.id, name: p.name, unit: p.unit, value, distribution: d }];
  });
}

/**
 * Incremental Monte Carlo run: call step() repeatedly (e.g. from a Web Worker
 * between progress messages), then result(). Pure and deterministic.
 */
export class MonteCarloRun {
  readonly options: Required<Pick<MonteCarloOptions, "runs" | "seed">> & MonteCarloOptions;
  readonly params: UncertainParameter[];
  private readonly sim: Simulator;
  private readonly bounds: ReturnType<typeof parameterBounds>;
  private readonly samples: Sample[] = [];
  private readonly failures: string[] = [];
  private failed = 0;
  private next = 0;
  private readonly started = Date.now();
  private periodLabels: string[] = [];

  constructor(model: unknown, options: MonteCarloOptions) {
    if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100_000) throw new Error("Runs must be a whole number from 1 to 100,000.");
    this.sim = new Simulator(model, { scenarioId: options.scenarioId });
    this.options = { ...options, seed: options.seed ?? this.sim.model.settings.seed };
    this.params = uncertainParameters(this.sim.model, options.scenarioId);
    this.bounds = parameterBounds(this.sim.model);
  }

  get completed(): number {
    return this.next;
  }

  get done(): boolean {
    return this.next >= this.options.runs;
  }

  /** Executes up to `count` more runs. */
  step(count: number): void {
    const end = Math.min(this.options.runs, this.next + count);
    const model = this.sim.model;
    const hasCash = model.nodes.some((n) => n.type === "CASH");
    for (; this.next < end; this.next++) {
      const rng = createRng(deriveSeed(this.options.seed, this.next));
      const overrides: Record<string, number> = {};
      for (const p of this.params) overrides[p.id] = clamp(sample(p.distribution, p.value, rng), this.bounds.get(p.id));
      try {
        const r = this.sim.runWith(overrides, { includeNodeValues: false });
        const last = r.timeline[r.timeline.length - 1]!;
        if (this.periodLabels.length === 0) this.periodLabels = r.timeline.map((t) => t.period);
        const cashSeries = hasCash ? r.timeline.map((t) => t.cash.closing) : null;
        this.samples.push({
          mrr: last.metrics.mrr ?? 0,
          arr: last.metrics.arr ?? 0,
          customers: last.customers.closing,
          cash: hasCash ? last.cash.closing : null,
          minCash: cashSeries ? Math.min(...cashSeries) : null,
          breakEven: r.summary.breakEvenPeriod,
          profitable: last.profit.operatingProfit >= 0,
          cashOut: r.summary.cashOutPeriod !== null,
          guardrailViolated: r.guardrails.some((g) => !g.passed),
          mrrSeries: r.timeline.map((t) => t.metrics.mrr ?? 0),
          cashSeries,
        });
      } catch (e) {
        this.failed++;
        if (this.failures.length < 5) this.failures.push(`Run ${this.next + 1}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  result(): MonteCarloResult {
    const s = this.samples;
    const model = this.sim.model;
    const hasCash = model.nodes.some((n) => n.type === "CASH");
    const cash = s.map((x) => x.cash).filter((v): v is number => v !== null);
    const horizon = this.periodLabels.length;
    const band = (series: (x: Sample) => number[] | null): Band[] =>
      Array.from({ length: horizon }, (_, i) => {
        const st = describe(s.map((x) => series(x)?.[i]).filter((v): v is number => v !== undefined));
        return st ? { p10: st.p10, p50: st.p50, p90: st.p90 } : { p10: 0, p50: 0, p90: 0 };
      });
    const targetMrr = this.options.targetMrr ?? null;
    const targetCash = hasCash ? this.options.targetCash ?? null : null;
    return {
      runs: this.options.runs,
      completed: s.length,
      failed: this.failed,
      failures: this.failures,
      seed: this.options.seed,
      scenarioId: this.options.scenarioId ?? null,
      horizon,
      periodLabels: this.periodLabels,
      uncertainParameters: this.params,
      metrics: {
        mrr: describe(s.map((x) => x.mrr)),
        arr: describe(s.map((x) => x.arr)),
        customers: describe(s.map((x) => x.customers)),
        cash: hasCash ? describe(cash) : null,
        minCash: hasCash ? describe(s.map((x) => x.minCash!).filter((v) => v !== null)) : null,
        breakEvenPeriod: describe(s.map((x) => x.breakEven).filter((v): v is number => v !== null)),
      },
      probabilities: {
        profitability: fraction(s.map((x) => x.profitable)),
        cashOut: hasCash ? fraction(s.map((x) => x.cashOut)) : null,
        targetMrr: targetMrr === null ? null : fraction(s.map((x) => x.mrr >= targetMrr)),
        targetCash: targetCash === null ? null : fraction(cash.map((c) => c >= targetCash)),
        guardrailViolation: model.guardrails.some((g) => g.enabled) ? fraction(s.map((x) => x.guardrailViolated)) : null,
      },
      targets: { mrr: targetMrr, cash: targetCash },
      histograms: { mrr: histogram(s.map((x) => x.mrr)), cash: hasCash ? histogram(cash) : [] },
      bands: { mrr: band((x) => x.mrrSeries), cash: hasCash ? band((x) => x.cashSeries) : [] },
      durationMs: Date.now() - this.started,
    };
  }
}

/** Runs everything synchronously (tests, CLI, server). The browser uses MonteCarloRun inside a Web Worker. */
export function runMonteCarlo(model: unknown, options: MonteCarloOptions, onProgress?: (done: number, total: number) => void): MonteCarloResult {
  const run = new MonteCarloRun(model, options);
  while (!run.done) {
    run.step(50);
    onProgress?.(run.completed, options.runs);
  }
  return run.result();
}
