import { checkUnits, Decimal, FormulaError, isKnownUnit, parseFormula } from "@fin/formula-engine";
import type { z } from "zod";
import { findOutput, findSlot, FORMULA_RESERVED_VARIABLES, NODE_CATALOG, slotsFor, type SlotSpec } from "./catalog";
import { METRIC_KEYS } from "./metrics";
import { ModelSchema } from "./schemas";
import type { Distribution, Model, ModelNode, Parameter } from "./types";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Stable machine-readable code, e.g. "duplicate-id", "missing-input". */
  code: string;
  /** Plain-English message suitable for showing to a non-finance user. */
  message: string;
  /** JSON path into the model, when applicable. */
  path?: (string | number)[];
  nodeId?: string;
  connectionId?: string;
  parameterId?: string;
  scenarioId?: string;
}

export interface ModelValidationResult {
  /** True when there are no errors (warnings are allowed). */
  valid: boolean;
  /** The parsed model (defaults applied) when the input matched the schema. */
  model?: Model;
  issues: ValidationIssue[];
}

/** Parses unknown JSON and runs every structural and semantic check. */
export function validateModel(input: unknown): ModelValidationResult {
  const parsed = ModelSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, issues: zodIssues(parsed.error) };
  }
  const issues = validateParsedModel(parsed.data);
  return { valid: !issues.some((i) => i.severity === "error"), model: parsed.data, issues };
}

/** Parses a model and throws a readable error when invalid. */
export function parseModel(input: unknown): Model {
  const result = validateModel(input);
  if (!result.valid || !result.model) {
    const errors = result.issues.filter((i) => i.severity === "error");
    throw new ModelValidationError(errors);
  }
  return result.model;
}

export class ModelValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Model is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n` + issues.map((i) => `- ${i.message}`).join("\n"));
    this.name = "ModelValidationError";
  }
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    severity: "error" as const,
    code: "schema",
    message: `${issue.path.length ? issue.path.join(".") + ": " : ""}${issue.message}`,
    path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
  }));
}

/** Semantic checks on an already schema-valid model. Graph cycles are checked by the simulation engine. */
export function validateParsedModel(model: Model): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ severity: "error", code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ severity: "warning", code, message, ...extra });

  // ── Unique IDs ──
  const checkUnique = (kind: string, ids: string[], key: "nodeId" | "connectionId" | "parameterId" | "scenarioId" | undefined) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) error("duplicate-id", `Duplicate ${kind} ID "${id}".`, key ? { [key]: id } : {});
      seen.add(id);
    }
  };
  checkUnique("node", model.nodes.map((n) => n.id), "nodeId");
  checkUnique("connection", model.connections.map((c) => c.id), "connectionId");
  checkUnique("parameter", model.parameters.map((p) => p.id), "parameterId");
  checkUnique("scenario", model.scenarios.map((s) => s.id), "scenarioId");
  checkUnique("guardrail", model.guardrails.map((g) => g.id), undefined);

  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const params = new Map(model.parameters.map((p) => [p.id, p]));

  // ── Parameters ──
  for (const p of model.parameters) {
    issues.push(...validateParameter(p));
  }

  // ── Node → parameter bindings ──
  const paramUsage = new Map<string, string[]>();
  const slotRanges = new Map<string, { range: NonNullable<SlotSpec["range"]>; what: string; nodeId: string }[]>();
  for (const node of model.nodes) {
    for (const [slotName, paramId] of Object.entries(node.parameters)) {
      const slot = findSlot(node, slotName);
      if (!slot) {
        error("unknown-slot", `${node.label}: "${slotName}" is not an input of a ${NODE_CATALOG[node.type].label} node.`, { nodeId: node.id });
        continue;
      }
      if (!slot.parameter) {
        error("slot-not-parameter", `${node.label}: "${slot.label}" must be connected from another node, not set directly.`, { nodeId: node.id });
      }
      const param = params.get(paramId);
      if (!param) {
        error("missing-parameter", `${node.label}: "${slot.label}" refers to a missing assumption "${paramId}".`, { nodeId: node.id, parameterId: paramId });
        continue;
      }
      paramUsage.set(paramId, [...(paramUsage.get(paramId) ?? []), node.id]);
      if (slot.range) {
        issues.push(...checkRange(param, param.value, slot.range, `${node.label}: ${slot.label}`, node.id));
        slotRanges.set(paramId, [...(slotRanges.get(paramId) ?? []), { range: slot.range, what: `${node.label}: ${slot.label}`, nodeId: node.id }]);
      }
    }
  }
  for (const p of model.parameters) {
    if (!paramUsage.has(p.id)) {
      warn("unused-parameter", `Assumption "${p.name}" is not used by any node.`, { parameterId: p.id });
      continue;
    }
    const nodeId = paramUsage.get(p.id)![0];
    if (p.status === "pending") {
      warn("unreviewed-assumption", `"${p.name}" was suggested by AI and has not been reviewed yet.`, { parameterId: p.id, nodeId });
    } else if (p.status === "rejected") {
      error("rejected-assumption", `"${p.name}" was rejected. Enter your own value or remove it.`, { parameterId: p.id, nodeId });
    }
  }

  // ── Connections ──
  const incoming = new Map<string, number>(); // `${target}:${port}` → count
  const pairSeen = new Set<string>();
  for (const c of model.connections) {
    const ref = { connectionId: c.id };
    const source = nodes.get(c.source);
    const target = nodes.get(c.target);
    if (!source) error("dangling-connection", `Connection "${c.id}" starts at a missing node "${c.source}".`, ref);
    if (!target) error("dangling-connection", `Connection "${c.id}" ends at a missing node "${c.target}".`, ref);
    if (!source || !target) continue;
    if (c.source === c.target) {
      error("self-connection", `${source.label} cannot be connected to itself.`, { ...ref, nodeId: source.id });
      continue;
    }
    if (!findOutput(source, c.sourcePort)) {
      error("invalid-port", `${source.label} has no output "${c.sourcePort}".`, { ...ref, nodeId: source.id });
    }
    const slot = findSlot(target, c.targetPort);
    if (!slot) {
      error("invalid-port", `${target.label} has no input "${c.targetPort}".`, { ...ref, nodeId: target.id });
      continue;
    }
    if (!slot.connectable) {
      error("invalid-port", `${target.label}: "${slot.label}" cannot be connected; set it as an assumption instead.`, { ...ref, nodeId: target.id });
    }
    const pair = `${c.source}:${c.sourcePort}->${c.target}:${c.targetPort}`;
    if (pairSeen.has(pair)) error("duplicate-connection", `${source.label} is connected to ${target.label} "${slot.label}" more than once.`, ref);
    pairSeen.add(pair);
    const key = `${c.target}:${c.targetPort}`;
    incoming.set(key, (incoming.get(key) ?? 0) + 1);
    if (!slot.multiple && incoming.get(key)! > 1) {
      error("multiple-inputs", `${target.label}: "${slot.label}" accepts only one connection.`, { ...ref, nodeId: target.id });
    }
  }

  // ── Required inputs, per-type rules ──
  for (const node of model.nodes) {
    for (const slot of slotsFor(node)) {
      const connected = (incoming.get(`${node.id}:${slot.name}`) ?? 0) > 0;
      const bound = node.parameters[slot.name] !== undefined;
      if (slot.required && !connected && !bound && slot.default === undefined) {
        error("missing-input", `${node.label}: "${slot.label}" is required. Connect a node or enter a value.`, { nodeId: node.id });
      }
      if (connected && bound) {
        warn("input-overridden", `${node.label}: "${slot.label}" is both connected and set directly. The connection is used.`, { nodeId: node.id });
      }
    }
    issues.push(...validateNodeConfig(node, model, params));
  }

  // ── Scenarios ──
  const scenarioIds = new Set(model.scenarios.map((s) => s.id));
  for (const s of model.scenarios) {
    const ref = { scenarioId: s.id };
    if (s.parentId !== undefined && !scenarioIds.has(s.parentId)) {
      error("missing-scenario", `Scenario "${s.name}" builds on a missing scenario "${s.parentId}".`, ref);
    }
    const overridden = new Set<string>();
    for (const o of s.overrides) {
      const p = params.get(o.parameterId);
      if (!p) {
        error("missing-parameter", `Scenario "${s.name}" overrides a missing assumption "${o.parameterId}".`, { ...ref, parameterId: o.parameterId });
        continue;
      }
      if (overridden.has(o.parameterId)) error("duplicate-override", `Scenario "${s.name}" overrides "${p.name}" more than once.`, ref);
      overridden.add(o.parameterId);
      if (o.value === undefined && o.distribution === undefined) {
        warn("empty-override", `Scenario "${s.name}" lists "${p.name}" without changing it.`, ref);
      }
      if (o.value !== undefined) {
        issues.push(...validateParameter({ ...p, value: o.value, distribution: o.distribution ?? p.distribution }, s));
        for (const r of slotRanges.get(p.id) ?? []) {
          issues.push(...checkRange(p, o.value, r.range, `${r.what} in scenario "${s.name}"`, r.nodeId).map((i) => ({ ...i, scenarioId: s.id })));
        }
      }
    }
  }
  const parentOf = new Map(model.scenarios.map((s) => [s.id, s.parentId]));
  for (const s of model.scenarios) {
    const seen = new Set<string>([s.id]);
    let cur = parentOf.get(s.id);
    while (cur !== undefined) {
      if (seen.has(cur)) {
        error("scenario-cycle", `Scenario "${s.name}" inherits from itself through its parents.`, { scenarioId: s.id });
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  // ── Guardrails ──
  for (const g of model.guardrails) {
    if (!METRIC_KEYS.has(g.metric)) error("unknown-metric", `Guardrail "${g.label}" uses an unknown metric "${g.metric}".`);
  }

  return issues;
}

function checkRange(
  param: Parameter,
  value: number,
  range: { min?: number; max?: number; message: string },
  what: string,
  nodeId?: string,
): ValidationIssue[] {
  if ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) {
    return [{ severity: "error", code: "out-of-range", message: `${what} ${range.message}.`, parameterId: param.id, ...(nodeId ? { nodeId } : {}) }];
  }
  return [];
}

/** Checks a single parameter (also used for scenario overrides). */
export function validateParameter(p: Parameter, scenario?: { id: string; name: string }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ref = { parameterId: p.id, ...(scenario ? { scenarioId: scenario.id } : {}) };
  const where = scenario ? ` in scenario "${scenario.name}"` : "";
  const err = (code: string, message: string) => issues.push({ severity: "error", code, message, ...ref });

  if (!scenario && !isKnownUnit(p.unit)) {
    issues.push({ severity: "warning", code: "unknown-unit", message: `"${p.name}" uses an unrecognized unit "${p.unit}".`, ...ref });
  }
  if (p.min !== undefined && p.max !== undefined && p.min > p.max) err("invalid-range", `"${p.name}": minimum is greater than maximum.`);
  if (p.min !== undefined && p.value < p.min) err("out-of-range", `"${p.name}"${where} is below its minimum (${p.min}).`);
  if (p.max !== undefined && p.value > p.max) err("out-of-range", `"${p.name}"${where} is above its maximum (${p.max}).`);
  if (p.distribution) {
    for (const message of distributionProblems(p.distribution)) err("invalid-distribution", `"${p.name}"${where}: ${message}`);
  }
  return issues;
}

export function distributionProblems(d: Distribution): string[] {
  switch (d.type) {
    case "fixed":
      return [];
    case "uniform":
      return d.min > d.max ? ["uniform minimum is greater than maximum."] : [];
    case "normal":
      return d.stdDev < 0 ? ["standard deviation must not be negative."] : [];
    case "lognormal":
      return [
        ...(d.mean <= 0 ? ["log-normal mean must be greater than zero."] : []),
        ...(d.stdDev < 0 ? ["standard deviation must not be negative."] : []),
      ];
    case "triangular":
      return d.min <= d.mode && d.mode <= d.max ? [] : ["triangular values must satisfy minimum ≤ most likely ≤ maximum."];
    case "discrete": {
      const problems: string[] = [];
      if (d.outcomes.some((o) => o.weight < 0)) problems.push("outcome weights must not be negative.");
      if (d.outcomes.reduce((a, o) => a + o.weight, 0) <= 0) problems.push("outcome weights must add up to more than zero.");
      return problems;
    }
  }
}

function validateNodeConfig(
  node: ModelNode,
  model: Model,
  params: Map<string, Parameter>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ref = { nodeId: node.id };
  const err = (code: string, message: string) => issues.push({ severity: "error", code, message, ...ref });

  switch (node.type) {
    case "SPLIT": {
      const keys = new Set<string>();
      let total = new Decimal(0);
      let complete = true;
      for (const b of node.config.branches) {
        if (keys.has(b.key)) err("duplicate-branch", `${node.label}: branch "${b.key}" appears more than once.`);
        keys.add(b.key);
        const p = params.get(node.parameters[`weight.${b.key}`] ?? "");
        if (p) total = total.plus(p.value);
        else complete = false;
      }
      if (complete && !total.eq(1)) {
        err("split-total", `${node.label}: shares must total 100% (currently ${total.times(100).toDecimalPlaces(4).toString()}%).`);
      }
      break;
    }
    case "COST": {
      const { startPeriod, endPeriod, tiers, costType } = node.config;
      if (startPeriod !== undefined && endPeriod !== undefined && endPeriod < startPeriod) {
        err("invalid-period", `${node.label}: end period is before start period.`);
      }
      if (costType === "step") {
        if (!tiers || tiers.length === 0) err("missing-tiers", `${node.label}: a step cost needs at least one tier.`);
        else {
          for (let i = 0; i < tiers.length; i++) {
            const t = tiers[i]!;
            if (t.cost < 0) err("out-of-range", `${node.label}: tier costs must not be negative.`);
            const isLast = i === tiers.length - 1;
            if (!isLast && t.upTo === undefined) err("invalid-tiers", `${node.label}: only the last tier may be open-ended.`);
            const prev = tiers[i - 1]?.upTo;
            if (t.upTo !== undefined && prev !== undefined && t.upTo <= prev) err("invalid-tiers", `${node.label}: tier limits must increase.`);
          }
        }
      } else if (tiers && tiers.length > 0) {
        issues.push({ severity: "warning", code: "unused-tiers", message: `${node.label}: tiers are only used by step costs.`, ...ref });
      }
      break;
    }
    case "GROWTH": {
      const { startPeriod, endPeriod } = node.config;
      if (endPeriod !== undefined && endPeriod < startPeriod) err("invalid-period", `${node.label}: end period is before start period.`);
      break;
    }
    case "FORMULA": {
      try {
        const ast = parseFormula(node.config.expression);
        const units: Record<string, string | undefined> = {};
        for (const slot of slotsFor(node)) units[slot.name] = variableUnit(node, slot.name, model, params);
        for (const r of FORMULA_RESERVED_VARIABLES) units[r] = "number";
        for (const w of checkUnits(ast, units).warnings) {
          issues.push({ severity: "warning", code: "unit-mismatch", message: `${node.label}: ${w.message}`, ...ref });
        }
      } catch (e) {
        if (e instanceof FormulaError) err("invalid-formula", `${node.label}: ${e.message}${e.position !== undefined ? ` (at character ${e.position + 1})` : ""}`);
        else throw e;
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

/** Best-effort unit of a formula variable: bound parameter unit, else the unit of the connected source node. */
function variableUnit(node: ModelNode, slot: string, model: Model, params: Map<string, Parameter>): string | undefined {
  const paramId = node.parameters[slot];
  const conn = model.connections.find((c) => c.target === node.id && c.targetPort === slot);
  if (conn) {
    const source = model.nodes.find((n) => n.id === conn.source);
    if (!source) return undefined;
    if (source.unit) return source.unit;
    if (source.type === "INPUT") return params.get(source.parameters.value ?? "")?.unit;
    return undefined;
  }
  return paramId ? params.get(paramId)?.unit : undefined;
}
