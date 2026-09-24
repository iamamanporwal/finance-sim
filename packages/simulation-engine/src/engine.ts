import { Decimal } from "@fin/formula-engine";
import { findOutput, slotsFor, type Model, type ModelNode, type SimulationResult } from "@fin/model-schema";
import { buildEvents, buildSummary, buildTimeline, evaluateGuardrails, guardrailEvents } from "./financials";
import { DependencyGraph } from "./graph";
import { behaviorFor, SimulationError, type NodeRuntime, type PortValues } from "./nodes";
import { buildPeriods, PERIODS_PER_YEAR, type Period } from "./time";
import { resolveParameterValues, SimulationBlockedError, validateForSimulation, validateParsedForSimulation } from "./validation";

export interface SimulateOptions {
  /** Scenario whose overrides apply on top of the base assumptions. */
  scenarioId?: string;
  /** Extra per-parameter values applied last (what-if edits, Monte Carlo samples). */
  parameterOverrides?: Readonly<Record<string, number | Decimal>>;
  /** Overrides model.settings.seed. */
  seed?: number;
  runId?: string;
}

interface SlotSource {
  nodeId: string;
  port: string;
}

interface ResolvedSlot {
  sources: SlotSource[];
  parameterId?: string;
  default?: number;
  required: boolean;
  label: string;
}

interface CompiledNode {
  node: ModelNode;
  slots: Map<string, ResolvedSlot>;
  stateful: boolean;
}

export interface RecalculationResult {
  result: SimulationResult;
  /** IDs of nodes that were re-evaluated (everything else came from cache). */
  recomputed: string[];
}

/**
 * Runs a model forward in time.
 *
 *   initialize state
 *   for each period:
 *     open stocks (opening balance = previous closing)   ← lagged values
 *     evaluate nodes in topological order                 ← inputs, dependencies, flows, pools
 *     aggregate financials, metrics, events, guardrails   ← after the loop, per period
 *
 * Deterministic: the same model, parameter values and seed always produce the
 * same result. Keeps per-node outputs cached so that changing one assumption
 * re-evaluates only the nodes downstream of it.
 */
export class Simulator {
  readonly model: Model;
  readonly graph: DependencyGraph;
  readonly periods: readonly Period[];
  private readonly order: string[];
  private readonly compiled: Map<string, CompiledNode>;
  private readonly options: SimulateOptions;
  private overrides: Record<string, number | Decimal>;
  private values: Map<string, Decimal>;
  private outputs = new Map<string, PortValues[]>();
  private dirty = new Set<string>();
  private hasRun = false;
  /** How many times each node has been evaluated for a full timeline (for diagnostics and tests). */
  readonly evaluationCounts = new Map<string, number>();

  constructor(input: unknown, options: SimulateOptions = {}) {
    const validation = validateForSimulation(input);
    if (!validation.valid || !validation.model) throw new SimulationBlockedError(validation.issues);
    const model = validation.model;
    if (options.scenarioId && !model.scenarios.some((s) => s.id === options.scenarioId)) {
      throw new SimulationBlockedError([{ severity: "error", code: "missing-scenario", message: `Unknown scenario "${options.scenarioId}".` }]);
    }
    this.model = model;
    this.options = options;
    this.overrides = { ...(options.parameterOverrides ?? {}) };
    this.graph = DependencyGraph.fromModel(model);
    this.order = this.graph.topologicalOrder();
    this.periods = buildPeriods(model.settings);
    this.compiled = compileNodes(model);
    this.values = resolveParameterValues(model, options.scenarioId, this.overrides);
  }

  get seed(): number {
    return this.options.seed ?? this.model.settings.seed;
  }

  /** Full simulation of every node over every period. */
  run(): SimulationResult {
    this.evaluate(new Set(this.order));
    this.hasRun = true;
    this.dirty.clear();
    return this.buildResult();
  }

  /**
   * Changes one assumption (on top of base + scenario) and marks it and every
   * node downstream of it as dirty. Throws SimulationBlockedError when the new
   * value makes the model invalid (e.g. conversion rate above 100%).
   */
  setParameter(parameterId: string, value: number | Decimal): this {
    if (!this.values.has(parameterId)) throw new Error(`Unknown parameter "${parameterId}".`);
    const numeric = typeof value === "number" ? value : value.toNumber();
    if (!Number.isFinite(numeric)) throw new SimulationBlockedError([{ severity: "error", code: "schema", message: "Value must be a finite number.", parameterId }]);

    const candidate: Model = { ...this.model, parameters: this.model.parameters.map((p) => (p.id === parameterId ? { ...p, value: numeric } : p)) };
    const problems = validateParsedForSimulation(candidate).filter((i) => i.severity === "error" && i.parameterId === parameterId);
    if (problems.length > 0) throw new SimulationBlockedError(problems);

    this.overrides[parameterId] = value;
    this.values = resolveParameterValues(this.model, this.options.scenarioId, this.overrides);
    const users = this.model.nodes.filter((n) => Object.values(n.parameters).includes(parameterId)).map((n) => n.id);
    for (const id of this.graph.downstreamOf(users)) this.dirty.add(id);
    return this;
  }

  /** Nodes that will be re-evaluated by the next recalculate(). */
  get dirtyNodes(): ReadonlySet<string> {
    return this.dirty;
  }

  /** Re-evaluates only dirty nodes, reusing cached outputs for everything else. */
  recalculate(): RecalculationResult {
    if (!this.hasRun) {
      const result = this.run();
      return { result, recomputed: [...this.order] };
    }
    const dirty = new Set(this.dirty);
    this.evaluate(dirty);
    this.dirty.clear();
    return { result: this.buildResult(), recomputed: this.order.filter((id) => dirty.has(id)) };
  }

  /** Raw per-period outputs of one node (Decimal precision). */
  nodeOutputs(nodeId: string): readonly PortValues[] | undefined {
    return this.outputs.get(nodeId);
  }

  private evaluate(targets: Set<string>) {
    const horizon = this.periods.length;
    const periodsPerYear = PERIODS_PER_YEAR[this.model.settings.timeStep];
    const states = new Map<string, Record<string, unknown>>();
    const ordered = this.order.filter((id) => targets.has(id));
    const stateful = ordered.filter((id) => this.compiled.get(id)!.stateful);

    for (const id of ordered) {
      states.set(id, {});
      this.outputs.set(id, new Array<PortValues>(horizon));
      this.evaluationCounts.set(id, (this.evaluationCounts.get(id) ?? 0) + 1);
    }

    for (let t = 1; t <= horizon; t++) {
      // 1. Open stocks: opening balances are known before anything else runs this period.
      for (const id of stateful) {
        const c = this.compiled.get(id)!;
        const rt = this.runtime(c, t, periodsPerYear, states.get(id)!);
        const opening = behaviorFor(c.node).open!(c.node, rt);
        this.outputs.get(id)![t - 1] = { opening };
      }
      // 2. Evaluate in dependency order.
      for (const id of ordered) {
        const c = this.compiled.get(id)!;
        const slot = this.outputs.get(id)!;
        const opening = slot[t - 1]?.opening ?? new Decimal(0);
        const rt: NodeRuntime = { ...this.runtime(c, t, periodsPerYear, states.get(id)!), opening };
        const result = behaviorFor(c.node).evaluate(c.node, rt);
        for (const [port, v] of Object.entries(result)) {
          if (!v.isFinite()) throw new SimulationError(`${c.node.label}: "${port}" is not a finite number.`, id, t);
        }
        slot[t - 1] = { ...slot[t - 1], ...result };
      }
    }
  }

  private runtime(c: CompiledNode, period: number, periodsPerYear: number, state: Record<string, unknown>): Omit<NodeRuntime, "opening"> {
    return {
      period,
      periodsPerYear,
      state,
      has: (name) => {
        const s = c.slots.get(name);
        return !!s && (s.sources.length > 0 || s.parameterId !== undefined);
      },
      input: (name) => this.resolveSlot(c, name, period),
    };
  }

  private resolveSlot(c: CompiledNode, name: string, period: number): Decimal {
    const slot = c.slots.get(name);
    if (!slot) throw new SimulationError(`${c.node.label}: unknown input "${name}".`, c.node.id, period);
    if (slot.sources.length > 0) {
      let total = new Decimal(0);
      for (const s of slot.sources) {
        const v = this.outputs.get(s.nodeId)?.[period - 1]?.[s.port];
        if (v === undefined) {
          throw new SimulationError(`${c.node.label}: input "${slot.label}" is not available from ${this.graph.labelOf(s.nodeId)} (port "${s.port}").`, c.node.id, period);
        }
        total = total.plus(v);
      }
      return total;
    }
    if (slot.parameterId !== undefined) {
      const v = this.values.get(slot.parameterId);
      if (v === undefined) throw new SimulationError(`${c.node.label}: assumption "${slot.parameterId}" is missing.`, c.node.id, period);
      return v;
    }
    if (slot.default !== undefined) return new Decimal(slot.default);
    throw new SimulationError(`${c.node.label}: "${slot.label}" is required but has no value.`, c.node.id, period);
  }

  private buildResult(): SimulationResult {
    const timeline = buildTimeline(this.model, this.periods, this.outputs);
    const scenarioId = this.options.scenarioId ?? null;
    const guardrails = evaluateGuardrails(this.model, timeline);
    const events = [...buildEvents(this.model, timeline), ...guardrailEvents(this.model, guardrails, timeline)].sort((a, b) => a.period - b.period);
    return {
      runId: this.options.runId ?? `${this.model.id}-v${this.model.version}-${scenarioId ?? "base"}-s${this.seed}`,
      modelId: this.model.id,
      modelVersion: this.model.version,
      scenarioId,
      seed: this.seed,
      settings: { ...this.model.settings, seed: this.seed },
      timeline,
      summary: buildSummary(this.model, timeline),
      events,
      guardrails,
    };
  }
}

function compileNodes(model: Model): Map<string, CompiledNode> {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const compiled = new Map<string, CompiledNode>();
  for (const node of model.nodes) {
    const slots = new Map<string, ResolvedSlot>();
    for (const spec of slotsFor(node)) {
      const sources = model.connections
        .filter((c) => c.target === node.id && c.targetPort === spec.name)
        .map((c) => ({ nodeId: c.source, port: c.sourcePort }));
      slots.set(spec.name, {
        sources,
        parameterId: node.parameters[spec.name],
        default: spec.default,
        required: spec.required,
        label: spec.label,
      });
    }
    compiled.set(node.id, { node, slots, stateful: behaviorFor(node).open !== undefined });
  }
  // Sanity check: every source port exists (validators guarantee this; keeps the engine safe if called directly).
  for (const c of model.connections) {
    const source = nodes.get(c.source);
    if (source && !findOutput(source, c.sourcePort)) throw new Error(`Node "${source.label}" has no output "${c.sourcePort}".`);
  }
  return compiled;
}

/** Validates and runs a model once. Throws SimulationBlockedError for invalid models. */
export function simulate(model: unknown, options: SimulateOptions = {}): SimulationResult {
  return new Simulator(model, options).run();
}
