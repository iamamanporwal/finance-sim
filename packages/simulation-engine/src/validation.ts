import { Decimal } from "@fin/formula-engine";
import {
  NODE_CATALOG,
  validateModel,
  validateParsedModel,
  type Model,
  type ModelValidationResult,
  type ValidationIssue,
} from "@fin/model-schema";
import { DependencyGraph } from "./graph";

export class SimulationBlockedError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === "error");
    super(
      `Simulation blocked — ${errors.length} issue${errors.length === 1 ? "" : "s"} found:\n` +
        errors.map((i) => `- ${i.message}`).join("\n"),
    );
    this.name = "SimulationBlockedError";
  }
}

/** Schema + semantic validation plus graph checks that only matter for running the model. */
export function validateForSimulation(input: unknown): ModelValidationResult {
  const base = validateModel(input);
  if (!base.model) return base;
  const issues = [...base.issues, ...graphIssues(base.model)];
  return { valid: !issues.some((i) => i.severity === "error"), model: base.model, issues };
}

/** Same as validateForSimulation for an already-parsed model. */
export function validateParsedForSimulation(model: Model): ValidationIssue[] {
  return [...validateParsedModel(model), ...graphIssues(model)];
}

function graphIssues(model: Model): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const graph = DependencyGraph.fromModel(model);

  const cycle = graph.findCycle();
  if (cycle) {
    issues.push({
      severity: "error",
      code: "circular-dependency",
      message: `Circular dependency detected. ${cycle.map((id) => graph.labelOf(id)).join(" → ")}`,
      nodeId: cycle[0],
    });
  }

  if (model.nodes.length > 1) {
    const connected = new Set(model.connections.flatMap((c) => [c.source, c.target]));
    for (const n of model.nodes) {
      if (!connected.has(n.id) && NODE_CATALOG[n.type].role === undefined) {
        issues.push({ severity: "warning", code: "disconnected-node", message: `${n.label} is not connected to anything.`, nodeId: n.id });
      }
    }
  }

  const cashNodes = model.nodes.filter((n) => n.type === "CASH");
  if (cashNodes.length === 0) {
    if (model.nodes.some((n) => ["REVENUE", "COST", "ACQUISITION"].includes(n.type))) {
      issues.push({ severity: "warning", code: "no-cash", message: "The model has no Cash node, so cash and runway cannot be calculated." });
    }
  } else {
    // Every revenue/cost must reach cash, otherwise the cash balance silently ignores it.
    const feedsCash = graph.upstreamOf(cashNodes.map((n) => n.id));
    for (const n of model.nodes) {
      if ((n.type === "REVENUE" || n.type === "COST") && !feedsCash.has(n.id)) {
        issues.push({
          severity: "warning",
          code: "not-in-cash",
          message: `${n.label} is not connected to Cash, so it does not affect the cash balance.`,
          nodeId: n.id,
        });
      }
      if (n.type === "ACQUISITION") {
        const hasBudget = n.parameters.budget !== undefined || model.connections.some((c) => c.target === n.id && c.targetPort === "budget");
        const spendReachesCash = model.connections.some((c) => c.source === n.id && c.sourcePort === "spend" && feedsCash.has(c.target));
        if (hasBudget && !spendReachesCash) {
          issues.push({
            severity: "warning",
            code: "not-in-cash",
            message: `${n.label}: marketing spend is not connected to Cash, so it does not affect the cash balance.`,
            nodeId: n.id,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Effective parameter values for a scenario: base values, then each ancestor
 * scenario's overrides (root first), then the scenario's own overrides, then
 * any extra overrides (what-if edits, Monte Carlo samples).
 */
export function resolveParameterValues(
  model: Model,
  scenarioId?: string | null,
  extra?: Readonly<Record<string, Decimal | number>>,
): Map<string, Decimal> {
  const values = new Map(model.parameters.map((p) => [p.id, new Decimal(p.value)]));
  if (scenarioId) {
    const byId = new Map(model.scenarios.map((s) => [s.id, s]));
    const chain = [];
    const seen = new Set<string>();
    let cur = byId.get(scenarioId);
    if (!cur) throw new Error(`Unknown scenario "${scenarioId}".`);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    for (const s of chain) {
      for (const o of s.overrides) if (o.value !== undefined && values.has(o.parameterId)) values.set(o.parameterId, new Decimal(o.value));
    }
  }
  if (extra) {
    for (const [id, v] of Object.entries(extra)) {
      if (!values.has(id)) throw new Error(`Unknown parameter "${id}".`);
      values.set(id, new Decimal(v));
    }
  }
  return values;
}
