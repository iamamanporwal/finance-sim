import type { Model, SimulationResult } from "@fin/model-schema";
import { boundParameterIds, clamp, parameterBounds } from "./bounds";
import { Simulator } from "./engine";
import { resolveParameterValues } from "./validation";

export interface SensitivityOptions {
  /** Timeline metric key, e.g. "mrr", "cash", "customers", "grossMargin". */
  metric: string;
  /** 1-based period; defaults to the last period. */
  period?: number;
  /** Relative change applied down and up (0.1 = ±10%). */
  delta?: number;
  scenarioId?: string;
  /** Limit the analysis to these parameters (default: every parameter a node uses). */
  parameterIds?: string[];
}

export interface SensitivityEntry {
  parameterId: string;
  name: string;
  unit: string;
  baseValue: number;
  lowValue: number;
  highValue: number;
  /** Metric value when the assumption is moved down / up. */
  lowResult: number | null;
  highResult: number | null;
  /** |highResult − lowResult|: the size of the swing. */
  impact: number;
  /** Whether raising the assumption raises the metric. */
  direction: "up" | "down" | "none";
  /** Set when a perturbed run failed or the value could not be moved (e.g. it is zero). */
  note?: string;
}

export interface SensitivityResult {
  metric: string;
  period: number;
  periodLabel: string;
  delta: number;
  baseResult: number | null;
  entries: SensitivityEntry[];
  runs: number;
}

/**
 * One-at-a-time sensitivity ("What matters most?"): each assumption is moved
 * down and up by `delta` while everything else stays fixed, and the swing in the
 * chosen metric is measured. Every number comes from real simulation runs.
 */
export function runSensitivity(input: unknown, options: SensitivityOptions): SensitivityResult {
  const sim = input instanceof Simulator ? input : new Simulator(input, { scenarioId: options.scenarioId });
  const model = sim.model;
  const delta = options.delta ?? 0.1;
  const base = sim.runWith({}, { includeNodeValues: false });
  const period = Math.min(Math.max(1, options.period ?? base.timeline.length), base.timeline.length);
  const read = (r: SimulationResult) => {
    const v = r.timeline[period - 1]?.metrics[options.metric];
    return v === undefined ? null : v;
  };
  const baseResult = read(base);
  const bounds = parameterBounds(model);
  const effective = resolveParameterValues(model, options.scenarioId);
  const ids = options.parameterIds ?? boundParameterIds(model);
  let runs = 1;

  const entries: SensitivityEntry[] = ids.flatMap((id) => {
    const p = model.parameters.find((x) => x.id === id);
    if (!p) return [];
    const value = effective.get(id)!.toNumber();
    const entry: SensitivityEntry = { parameterId: id, name: p.name, unit: p.unit, baseValue: value, lowValue: value, highValue: value, lowResult: baseResult, highResult: baseResult, impact: 0, direction: "none" };
    if (value === 0) return [{ ...entry, note: "Value is zero, so a relative change has no effect." }];
    const b = bounds.get(id);
    const lowValue = clamp(value * (1 - delta), b);
    const highValue = clamp(value * (1 + delta), b);
    const run = (v: number) => {
      runs++;
      try {
        return { value: read(sim.runWith({ [id]: v }, { includeNodeValues: false })) };
      } catch (e) {
        return { value: null, error: e instanceof Error ? e.message : String(e) };
      }
    };
    const low = lowValue === value ? { value: baseResult } : run(lowValue);
    const high = highValue === value ? { value: baseResult } : run(highValue);
    const impact = low.value !== null && high.value !== null ? Math.abs(high.value - low.value) : 0;
    const direction = low.value === null || high.value === null || impact === 0 ? "none" : high.value > low.value ? "up" : "down";
    const note = "error" in low && low.error ? low.error : "error" in high && high.error ? high.error : undefined;
    return [{ ...entry, lowValue, highValue, lowResult: low.value, highResult: high.value, impact, direction, ...(note ? { note } : {}) }];
  });

  entries.sort((a, b) => b.impact - a.impact || a.name.localeCompare(b.name));
  return { metric: options.metric, period, periodLabel: base.timeline[period - 1]!.period, delta, baseResult, entries, runs };
}
