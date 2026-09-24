/** Pure scenario and guardrail editing operations. Scenarios store only overrides. */
import { getMetricDefinition, type Guardrail, type Model, type Scenario, type ScenarioOverride } from "@fin/model-schema";
import { generateScenarioOverrides, resolveParameterValues } from "@fin/simulation-engine";
import { newId } from "./ids";

export function addScenario(model: Model, init: { name: string; kind?: Scenario["kind"]; parentId?: string; overrides?: ScenarioOverride[]; description?: string }): { model: Model; id: string } {
  const id = newId("s");
  const scenario: Scenario = { id, name: init.name, kind: init.kind ?? "custom", parentId: init.parentId, overrides: init.overrides ?? [], description: init.description };
  return { model: { ...model, scenarios: [...model.scenarios, scenario] }, id };
}

export function duplicateScenario(model: Model, id: string): { model: Model; id: string } {
  const src = model.scenarios.find((s) => s.id === id);
  if (!src) return { model, id };
  const names = new Set(model.scenarios.map((s) => s.name));
  let name = `${src.name} copy`;
  for (let i = 2; names.has(name); i++) name = `${src.name} copy ${i}`;
  return addScenario(model, { name, kind: "custom", parentId: src.parentId, overrides: structuredClone(src.overrides), description: src.description });
}

export function updateScenario(model: Model, id: string, patch: Partial<Pick<Scenario, "name" | "description" | "kind">>): Model {
  return { ...model, scenarios: model.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Deletes a scenario; children inherit from its parent instead. */
export function deleteScenario(model: Model, id: string): Model {
  const gone = model.scenarios.find((s) => s.id === id);
  return {
    ...model,
    scenarios: model.scenarios.filter((s) => s.id !== id).map((s) => (s.parentId === id ? { ...s, parentId: gone?.parentId } : s)),
  };
}

export function setOverride(model: Model, scenarioId: string, parameterId: string, value: number): Model {
  return {
    ...model,
    scenarios: model.scenarios.map((s) => {
      if (s.id !== scenarioId) return s;
      const exists = s.overrides.some((o) => o.parameterId === parameterId);
      return { ...s, overrides: exists ? s.overrides.map((o) => (o.parameterId === parameterId ? { ...o, value } : o)) : [...s.overrides, { parameterId, value }] };
    }),
  };
}

export function clearOverride(model: Model, scenarioId: string, parameterId: string): Model {
  return { ...model, scenarios: model.scenarios.map((s) => (s.id === scenarioId ? { ...s, overrides: s.overrides.filter((o) => o.parameterId !== parameterId) } : s)) };
}

/** The value a parameter has in a scenario (including inherited overrides). */
export function effectiveValue(model: Model, scenarioId: string | null, parameterId: string): number {
  return resolveParameterValues(model, scenarioId ?? undefined).get(parameterId)?.toNumber() ?? Number.NaN;
}

/** Which scenario (itself or an ancestor) overrides this parameter, if any. */
export function overrideSource(model: Model, scenarioId: string | null, parameterId: string): Scenario | null {
  const byId = new Map(model.scenarios.map((s) => [s.id, s]));
  for (let s = scenarioId ? byId.get(scenarioId) : undefined; s; s = s.parentId ? byId.get(s.parentId) : undefined) {
    if (s.overrides.some((o) => o.parameterId === parameterId && o.value !== undefined)) return s;
  }
  return null;
}

/**
 * Creates Base, Upside and Downside (any that do not exist yet). Upside/Downside
 * move each impactful assumption ±20% in its favorable/unfavorable direction,
 * using directions measured by a sensitivity analysis.
 */
export function createStandardScenarios(model: Model, magnitude = 0.2): Model {
  let m = model;
  const has = (kind: Scenario["kind"]) => m.scenarios.some((s) => s.kind === kind);
  if (!has("base")) m = addScenario(m, { name: "Base", kind: "base", description: "The model's own assumptions." }).model;
  for (const kind of ["upside", "downside"] as const) {
    if (has(kind)) continue;
    const overrides = generateScenarioOverrides(model, kind, { magnitude });
    m = addScenario(m, {
      name: kind === "upside" ? "Upside" : "Downside",
      kind,
      overrides,
      description: `Each assumption that affects the outcome moved ${Math.round(magnitude * 100)}% in its ${kind === "upside" ? "favorable" : "unfavorable"} direction. Edit freely.`,
    }).model;
  }
  return m;
}

// ── Guardrails ──

export const GUARDRAIL_SUGGESTIONS: Omit<Guardrail, "id" | "label" | "enabled">[] = [
  { metric: "grossMargin", operator: ">", threshold: 0.55, severity: "warning" },
  { metric: "runwayMonths", operator: ">", threshold: 6, severity: "critical" },
  { metric: "churnRate", operator: "<", threshold: 0.08, severity: "warning" },
  { metric: "cacPaybackMonths", operator: "<", threshold: 12, severity: "warning" },
  { metric: "cash", operator: ">", threshold: 0, severity: "critical" },
];

export function formatThreshold(metric: string, v: number, currency = "USD"): string {
  const unit = getMetricDefinition(metric)?.unit;
  if (unit === "percent") return `${Number((v * 100).toPrecision(10))}%`;
  if (unit === "months") return `${v} months`;
  if (unit === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0, notation: Math.abs(v) >= 100000 ? "compact" : "standard" }).format(v);
  return String(v);
}

export function guardrailLabel(g: Pick<Guardrail, "metric" | "operator" | "threshold">, currency = "USD"): string {
  return `${getMetricDefinition(g.metric)?.label ?? g.metric} ${g.operator} ${formatThreshold(g.metric, g.threshold, currency)}`;
}

export function addGuardrail(model: Model, g: Omit<Guardrail, "id" | "label" | "enabled"> & { label?: string }): Model {
  const guardrail: Guardrail = { id: newId("g"), enabled: true, ...g, label: g.label ?? guardrailLabel(g, model.settings.currency) };
  return { ...model, guardrails: [...model.guardrails, guardrail] };
}

export function updateGuardrail(model: Model, id: string, patch: Partial<Omit<Guardrail, "id">>): Model {
  return {
    ...model,
    guardrails: model.guardrails.map((g) => {
      if (g.id !== id) return g;
      const next = { ...g, ...patch };
      // Keep auto-generated labels in sync with the rule.
      if (patch.label === undefined && g.label === guardrailLabel(g, model.settings.currency)) next.label = guardrailLabel(next, model.settings.currency);
      return next;
    }),
  };
}

export function removeGuardrail(model: Model, id: string): Model {
  return { ...model, guardrails: model.guardrails.filter((g) => g.id !== id) };
}
