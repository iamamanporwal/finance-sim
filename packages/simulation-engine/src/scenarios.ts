import type { Model, ScenarioOverride, SimulationResult, SimulationSummary } from "@fin/model-schema";
import { clamp, parameterBounds } from "./bounds";
import { simulate, Simulator } from "./engine";
import { runSensitivity } from "./sensitivity";
import { resolveParameterValues } from "./validation";

export interface ScenarioComparisonRow {
  scenarioId: string | null;
  name: string;
  summary?: SimulationSummary;
  /** Lowest runway across all periods (null when never burning). */
  minRunwayMonths?: number | null;
  /** Lowest cash across all periods. */
  minCash?: number | null;
  result?: SimulationResult;
  error?: string;
}

/** Runs the base model and each scenario, returning comparable summaries. */
export function compareScenarios(model: unknown, scenarioIds: (string | null)[]): ScenarioComparisonRow[] {
  const sim = new Simulator(model);
  const scenarios = new Map(sim.model.scenarios.map((s) => [s.id, s]));
  return scenarioIds.map((id) => {
    const name = id === null ? "Base model" : scenarios.get(id)?.name ?? id;
    try {
      const result = simulate(sim.model, id === null ? {} : { scenarioId: id });
      const runways = result.timeline.map((p) => p.metrics.runwayMonths).filter((v): v is number => v !== null && v !== undefined);
      const cash = result.timeline.map((p) => p.metrics.cash).filter((v): v is number => v !== null && v !== undefined);
      return {
        scenarioId: id,
        name,
        summary: result.summary,
        minRunwayMonths: runways.length ? Math.min(...runways) : null,
        minCash: cash.length ? Math.min(...cash) : null,
        result,
      };
    } catch (e) {
      return { scenarioId: id, name, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * Builds overrides for an Upside or Downside case: every assumption with a
 * measurable effect on the target metric is moved by `magnitude` in its
 * favorable (upside) or unfavorable (downside) direction. Directions come from
 * a sensitivity analysis, never from guesses about what a parameter "means".
 */
export function generateScenarioOverrides(
  model: unknown,
  kind: "upside" | "downside",
  options: { magnitude?: number; metric?: string; baseScenarioId?: string } = {},
): ScenarioOverride[] {
  const sim = new Simulator(model, { scenarioId: options.baseScenarioId });
  const m: Model = sim.model;
  const metric = options.metric ?? (m.nodes.some((n) => n.type === "CASH") ? "cash" : "mrr");
  const magnitude = options.magnitude ?? 0.2;
  const sens = runSensitivity(sim, { metric, delta: 0.05, scenarioId: options.baseScenarioId });
  const bounds = parameterBounds(m);
  const values = resolveParameterValues(m, options.baseScenarioId);
  const overrides: ScenarioOverride[] = [];
  for (const e of sens.entries) {
    if (e.direction === "none") continue;
    const favorableUp = e.direction === "up";
    const goUp = kind === "upside" ? favorableUp : !favorableUp;
    const v = values.get(e.parameterId)!.toNumber();
    const next = clamp(v * (goUp ? 1 + magnitude : 1 - magnitude), bounds.get(e.parameterId));
    if (next !== v) overrides.push({ parameterId: e.parameterId, value: Number(next.toPrecision(12)) });
  }
  return overrides;
}
