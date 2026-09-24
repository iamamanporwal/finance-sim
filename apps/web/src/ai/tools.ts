/**
 * The copilot's tools. The AI can only read or change the model through these
 * handlers: arguments are validated with Zod, every edit goes through the same
 * validated model operations as the UI (and is undoable), and every number it
 * reports comes from the simulation engine.
 */
import type { AgentTool } from "@fin/ai";
import { METRIC_DEFINITIONS, NODE_CATALOG, outputsFor, slotsFor, type Model, type SimulationResult } from "@fin/model-schema";
import type { MonteCarloOptions, MonteCarloResult } from "@fin/monte-carlo";
import {
  compareScenarios,
  explainGuardrail,
  explainMetric,
  resolveParameterValues,
  runSensitivity,
  simulate,
  validateForSimulation,
  validateParsedForSimulation,
  type ScenarioComparisonRow,
} from "@fin/simulation-engine";
import { z } from "zod";
import { formatMetric, type Currency } from "@/lib/format";
import * as ops from "@/lib/model-ops";
import { NODE_PRESETS, findPreset } from "@/lib/presets";
import { addScenario, setOverride } from "@/lib/scenario-ops";

export interface ToolContext {
  getModel(): Model;
  /** Applies an edited model through the editor (validated, undoable). */
  commit(next: Model, summary: string): void;
  runMonteCarlo(options: MonteCarloOptions): Promise<MonteCarloResult | null>;
}

const METRIC_KEYS = METRIC_DEFINITIONS.map((m) => m.key) as [string, ...string[]];
const PRESET_IDS = NODE_PRESETS.map((p) => p.id) as [string, ...string[]];
const metric = z.enum(METRIC_KEYS).describe(`Metric key: ${METRIC_KEYS.join(", ")}`);
const scenarioArg = z.string().optional().describe("Scenario ID or name. Omit for the base model.");

class ToolError extends Error {}

/** "Churn double", "churn_double" and "churn-double" all match. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function createCopilotTools(ctx: ToolContext): AgentTool<never>[] {
  const model = () => ctx.getModel();
  const currency = () => model().settings.currency as Currency;
  const fmt = (key: string, v: number | null | undefined) => formatMetric(key, v ?? null, currency());
  const node = (id: string) => {
    const m = model();
    const n = m.nodes.find((x) => x.id === id) ?? m.nodes.find((x) => slug(x.label) === slug(id));
    if (!n) throw new ToolError(`No node "${id}". Call get_model to see node IDs.`);
    return n;
  };
  const scenarioId = (s?: string) => {
    if (!s || (s === "base" && !model().scenarios.some((x) => x.id === "base"))) return undefined;
    const m = model();
    const found = m.scenarios.find((x) => x.id === s) ?? m.scenarios.find((x) => slug(x.name) === slug(s));
    if (!found) throw new ToolError(`No scenario "${s}". Existing: ${m.scenarios.map((x) => `${x.name} (${x.id})`).join(", ") || "none"}.`);
    return found.id;
  };
  const run = (s?: string): SimulationResult => {
    const v = validateForSimulation(model());
    if (!v.valid) throw new ToolError(`Simulation blocked: ${v.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")}`);
    return simulate(model(), { scenarioId: scenarioId(s) });
  };
  const commit = (next: Model, summary: string) => {
    ctx.commit(next, summary);
    const errors = validateParsedForSimulation(next).filter((i) => i.severity === "error");
    return errors.length ? { model_errors: errors.map((e) => e.message) } : { model_valid: true };
  };
  const paramFor = (args: { parameter_id?: string; node_id?: string; slot?: string }) => {
    const m = model();
    if (args.parameter_id) {
      const p = m.parameters.find((x) => x.id === args.parameter_id) ?? m.parameters.find((x) => slug(x.name) === slug(args.parameter_id!));
      if (!p) throw new ToolError(`No assumption "${args.parameter_id}". Call get_model to list assumptions.`);
      return p;
    }
    if (args.node_id && args.slot) {
      const n = node(args.node_id);
      const pid = n.parameters[args.slot];
      if (!pid) throw new ToolError(`${n.label} has no assumption for "${args.slot}". Its assumptions: ${Object.keys(n.parameters).join(", ") || "none"}.`);
      return m.parameters.find((x) => x.id === pid)!;
    }
    throw new ToolError("Give parameter_id, or node_id and slot.");
  };
  const summarize = (r: SimulationResult) => {
    const last = r.timeline[r.timeline.length - 1]!;
    return {
      scenario: r.scenarioId,
      periods: `${r.timeline[0]!.period} to ${last.period}`,
      final_period: last.period,
      mrr: fmt("mrr", last.metrics.mrr),
      arr: fmt("arr", last.metrics.arr),
      customers: fmt("customers", last.customers.closing),
      gross_margin: fmt("grossMargin", last.profit.grossMargin),
      cash: last.metrics.cash === null ? "no Cash node" : fmt("cash", last.cash.closing),
      runway: fmt("runwayMonths", last.metrics.runwayMonths),
      break_even: r.summary.breakEvenPeriod ? r.timeline[r.summary.breakEvenPeriod - 1]!.period : "not reached",
      cash_out: r.summary.cashOutPeriod ? r.timeline[r.summary.cashOutPeriod - 1]!.period : "never",
      guardrails_broken: r.guardrails.filter((g) => !g.passed).map((g) => model().guardrails.find((x) => x.id === g.guardrailId)?.label),
    };
  };

  const tools = [
    tool({
      name: "get_model",
      description: "Overview of the model: nodes with their assumptions (parameter IDs, values), connections, scenarios and guardrails.",
      parameters: z.object({}),
      run: () => {
        const m = model();
        const values = resolveParameterValues(m);
        return {
          name: m.name,
          settings: m.settings,
          nodes: m.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.label,
            assumptions: Object.entries(n.parameters).map(([slot, pid]) => {
              const p = m.parameters.find((x) => x.id === pid)!;
              return { slot, parameter_id: pid, name: p.name, value: values.get(pid)?.toNumber(), unit: p.unit, source: p.source, status: p.status };
            }),
            inputs: m.connections.filter((c) => c.target === n.id).map((c) => `${c.targetPort} ← ${c.source}.${c.sourcePort}`),
          })),
          scenarios: m.scenarios.map((s) => ({ id: s.id, name: s.name, kind: s.kind, based_on: s.parentId, changes: s.overrides })),
          guardrails: m.guardrails.map((g) => g.label),
        };
      },
    }),
    tool({
      name: "get_node",
      description: "Details of one node: inputs, outputs, how it is calculated, and its values in the final simulated period.",
      parameters: z.object({ node_id: z.string().describe("Node ID or label") }),
      run: ({ node_id }) => {
        const n = node(node_id);
        const m = model();
        let values: Record<string, number> | undefined;
        try {
          const r = run();
          values = r.timeline[r.timeline.length - 1]!.nodes[n.id];
        } catch {
          values = undefined;
        }
        return {
          id: n.id,
          type: n.type,
          label: n.label,
          calculation: n.type === "FORMULA" ? n.config.expression : NODE_CATALOG[n.type].formula,
          config: n.config,
          inputs: slotsFor(n).map((s) => ({
            input: s.name,
            label: s.label,
            required: s.required,
            connected_from: m.connections.filter((c) => c.target === n.id && c.targetPort === s.name).map((c) => `${c.source}.${c.sourcePort}`),
            parameter_id: n.parameters[s.name],
          })),
          outputs: outputsFor(n).map((o) => o.name),
          final_period_values: values,
        };
      },
    }),
    tool({
      name: "get_connections",
      description: "List connections, optionally only those touching one node.",
      parameters: z.object({ node_id: z.string().optional() }),
      run: ({ node_id }) => {
        const id = node_id ? node(node_id).id : undefined;
        return model()
          .connections.filter((c) => !id || c.source === id || c.target === id)
          .map((c) => ({ id: c.id, from: `${c.source}.${c.sourcePort}`, to: `${c.target}.${c.targetPort}` }));
      },
    }),
    tool({
      name: "create_node",
      description: `Add a node from the library. Presets: ${NODE_PRESETS.map((p) => `${p.id} (${p.description})`).join("; ")}`,
      parameters: z.object({
        preset: z.enum(PRESET_IDS),
        label: z.string().min(1).max(80).optional(),
        values: z.record(z.string(), z.number()).optional().describe("Assumption values by input name, e.g. {\"rate\": 0.029}. Percentages as fractions."),
      }),
      run: ({ preset, label, values }) => {
        const p = findPreset(preset)!;
        const m0 = model();
        const maxX = Math.max(0, ...m0.nodes.map((n) => n.position.x));
        let { model: m, nodeId } = ops.addNode(m0, label ? { ...p, label } : p, { x: maxX + 280, y: 0 });
        m = { ...m, nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, metadata: { source: "ai" as const } } : n)) };
        for (const [slot, value] of Object.entries(values ?? {})) {
          const n = m.nodes.find((x) => x.id === nodeId)!;
          if (!slotsFor(n).some((s) => s.name === slot && s.parameter)) throw new ToolError(`"${slot}" is not an assumption of ${p.label}. Inputs: ${slotsFor(n).map((s) => s.name).join(", ")}.`);
          if (!n.parameters[slot]) m = ops.bindNewParameter(m, nodeId, slot);
          const pid = m.nodes.find((x) => x.id === nodeId)!.parameters[slot]!;
          m = ops.updateParameter(m, pid, { value, source: "ai", status: "pending", confidence: "medium" });
        }
        const n = m.nodes.find((x) => x.id === nodeId)!;
        return { node_id: nodeId, label: n.label, inputs: slotsFor(n).map((s) => s.name), outputs: outputsFor(n).map((o) => o.name), ...commit(m, `AI added ${n.label}`) };
      },
    }),
    tool({
      name: "update_node",
      description: "Rename a node or change its settings (e.g. cost type, revenue type, growth type).",
      parameters: z.object({ node_id: z.string(), label: z.string().min(1).max(80).optional(), config: z.record(z.string(), z.unknown()).optional() }),
      run: ({ node_id, label, config }) => {
        const n = node(node_id);
        const next = ops.updateNode(model(), n.id, { label, config: config ? { ...(n.config as object), ...config } : undefined });
        const updated = next.nodes.find((x) => x.id === n.id)!;
        if (config && JSON.stringify(updated.config) === JSON.stringify(n.config)) throw new ToolError(`Invalid settings for ${n.label}: ${JSON.stringify(config)}. Current settings: ${JSON.stringify(n.config)}.`);
        return { node_id: n.id, label: updated.label, config: updated.config, ...commit(next, `AI updated ${updated.label}`) };
      },
    }),
    tool({
      name: "delete_node",
      description: "Delete a node and its connections.",
      parameters: z.object({ node_id: z.string() }),
      run: ({ node_id }) => {
        const n = node(node_id);
        return { deleted: n.label, ...commit(ops.removeElements(model(), [n.id]), `AI deleted ${n.label}`) };
      },
    }),
    tool({
      name: "connect_nodes",
      description: "Connect an output of one node to an input of another.",
      parameters: z.object({ from_node: z.string(), from_port: z.string().default("out"), to_node: z.string(), to_input: z.string() }),
      run: ({ from_node, from_port, to_node, to_input }) => {
        const s = node(from_node);
        const t = node(to_node);
        const req = { source: s.id, sourcePort: from_port, target: t.id, targetPort: to_input };
        const check = ops.canConnect(model(), req);
        if (!check.ok) throw new ToolError(check.reason);
        return { connected: `${s.label}.${from_port} → ${t.label}.${to_input}`, ...commit(ops.connect(model(), req), `AI connected ${s.label} → ${t.label}`) };
      },
    }),
    tool({
      name: "disconnect_nodes",
      description: "Remove a connection by ID, or every connection from one node to another.",
      parameters: z.object({ connection_id: z.string().optional(), from_node: z.string().optional(), to_node: z.string().optional() }),
      run: ({ connection_id, from_node, to_node }) => {
        const m = model();
        const ids = connection_id
          ? [connection_id]
          : from_node && to_node
            ? m.connections.filter((c) => c.source === node(from_node).id && c.target === node(to_node).id).map((c) => c.id)
            : [];
        if (ids.length === 0 || !ids.every((id) => m.connections.some((c) => c.id === id))) throw new ToolError("No matching connection. Call get_connections.");
        return { removed: ids.length, ...commit(ops.removeElements(m, [], ids), "AI removed a connection") };
      },
    }),
    tool({
      name: "update_assumption",
      description: "Change an assumption's value, either absolutely (value) or relatively (change_percent: 0.2 = +20%). With scenario, the change is stored in that scenario only.",
      parameters: z.object({
        parameter_id: z.string().optional().describe("Assumption ID or name"),
        node_id: z.string().optional(),
        slot: z.string().optional(),
        value: z.number().optional().describe("New value; percentages as fractions"),
        change_percent: z.number().optional().describe("Relative change, e.g. 0.2 for +20%, -0.5 for −50%"),
        scenario: scenarioArg,
      }),
      run: (args) => {
        const p = paramFor(args);
        const sid = scenarioId(args.scenario);
        const m0 = model();
        const current = resolveParameterValues(m0, sid).get(p.id)!.toNumber();
        if (args.value === undefined && args.change_percent === undefined) throw new ToolError("Give value or change_percent.");
        const value = args.value ?? Number((current * (1 + args.change_percent!)).toPrecision(12));
        const next = sid ? setOverride(m0, sid, p.id, value) : ops.updateParameter(m0, p.id, { value, source: "user", status: "accepted" });
        const problems = validateParsedForSimulation(next).filter((i) => i.severity === "error" && i.parameterId === p.id);
        if (problems.length) throw new ToolError(problems.map((i) => i.message).join(" "));
        return { assumption: p.name, from: current, to: value, unit: p.unit, scenario: sid ?? "base model", ...commit(next, `AI changed ${p.name}`) };
      },
    }),
    tool({
      name: "create_scenario",
      description: "Create a what-if scenario that overrides some assumptions without touching the base model.",
      parameters: z.object({
        name: z.string().min(1).max(80),
        kind: z
          .string()
          .optional()
          .transform((k): "upside" | "downside" | "custom" => (k === "upside" || k === "downside" ? k : "custom"))
          .describe("upside, downside or custom"),
        based_on: scenarioArg,
        changes: z
          .array(z.object({ parameter_id: z.string().describe("Assumption ID or name"), value: z.number().optional(), change_percent: z.number().optional() }))
          .max(30)
          .default([]),
      }),
      run: ({ name, kind, based_on, changes }) => {
        const parent = scenarioId(based_on);
        const m0 = model();
        const base = resolveParameterValues(m0, parent);
        const overrides = changes.map((c) => {
          const p = paramFor({ parameter_id: c.parameter_id });
          if (c.value === undefined && c.change_percent === undefined) throw new ToolError(`Change for ${p.name} needs value or change_percent.`);
          const cur = base.get(p.id)!.toNumber();
          return { parameterId: p.id, value: c.value ?? Number((cur * (1 + c.change_percent!)).toPrecision(12)), name: p.name, from: cur };
        });
        const { model: next, id } = addScenario(m0, { name, kind, parentId: parent, overrides: overrides.map(({ parameterId, value }) => ({ parameterId, value })), description: "Created by the AI copilot." });
        const problems = validateParsedForSimulation(next).filter((i) => i.severity === "error" && i.scenarioId === id);
        if (problems.length) throw new ToolError(problems.map((i) => i.message).join(" "));
        return { scenario_id: id, name, changes: overrides.map((o) => ({ assumption: o.name, from: o.from, to: o.value })), ...commit(next, `AI created scenario ${name}`) };
      },
    }),
    tool({
      name: "validate_model",
      description: "Check the model for errors (which block simulation) and warnings.",
      parameters: z.object({}),
      run: () => {
        const v = validateForSimulation(model());
        return { valid: v.valid, errors: v.issues.filter((i) => i.severity === "error").map((i) => i.message), warnings: v.issues.filter((i) => i.severity === "warning").map((i) => i.message) };
      },
    }),
    tool({
      name: "run_simulation",
      description: "Run the simulation (base model or a scenario) and return the key results at the end of the forecast.",
      parameters: z.object({ scenario: scenarioArg }),
      run: ({ scenario }) => summarize(run(scenario)),
    }),
    tool({
      name: "compare_scenarios",
      description: "Compare the base model with one or more scenarios at the end of the forecast. Returns each metric plus the engine-computed difference from the base model. Use this instead of calculating differences yourself.",
      parameters: z.object({ scenarios: z.array(z.string()).min(1).max(6).describe("Scenario IDs or names") }),
      run: ({ scenarios }) => {
        const ids = scenarios.map((s) => scenarioId(s)).filter((s): s is string => !!s);
        const v = validateForSimulation(model());
        if (!v.valid) throw new ToolError(`Simulation blocked: ${v.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")}`);
        const rows = compareScenarios(model(), [null, ...ids]);
        const base = rows[0]!;
        const pick = (r: ScenarioComparisonRow) => ({
          mrr: r.summary?.mrr ?? null,
          arr: r.summary?.arr ?? null,
          customers: r.summary?.customers ?? null,
          grossMargin: r.summary?.grossMargin ?? null,
          cash: r.summary?.cash ?? null,
          runwayMonths: r.minRunwayMonths ?? null,
        });
        const b = pick(base);
        return rows.map((r) => {
          if (r.error) return { scenario: r.name, error: r.error };
          const cur = pick(r);
          const metrics = Object.fromEntries(
            (Object.keys(cur) as (keyof typeof cur)[]).map((k) => {
              const value = cur[k];
              const baseValue = b[k];
              const diff = value !== null && baseValue !== null ? value - baseValue : null;
              const pct = diff !== null && baseValue ? diff / Math.abs(baseValue) : null;
              return [k, { value: fmt(k, value), ...(r.scenarioId ? { vs_base: diff === null ? "n/a" : `${diff >= 0 ? "+" : "−"}${fmt(k === "grossMargin" ? "grossMargin" : k, Math.abs(diff))}${pct === null ? "" : ` (${pct >= 0 ? "+" : "−"}${Math.abs(pct * 100).toFixed(1)}%)`}` } : {}) }];
            }),
          );
          return {
            scenario: r.name,
            final_period: r.result?.timeline[r.result.timeline.length - 1]?.period,
            break_even: r.summary?.breakEvenPeriod ? r.result!.timeline[r.summary.breakEvenPeriod - 1]!.period : "not reached",
            ...metrics,
          };
        });
      },
    }),
    tool({
      name: "run_monte_carlo",
      description: "Run a Monte Carlo simulation over the uncertain assumptions. Returns P10/P50/P90 and probabilities.",
      parameters: z.object({ runs: z.number().int().min(100).max(10000).default(1000), scenario: scenarioArg }),
      run: async ({ runs, scenario }) => {
        const uncertain = model().parameters.filter((p) => p.distribution && p.distribution.type !== "fixed");
        if (uncertain.length === 0) throw new ToolError("No assumption has an uncertainty range, so every run would be identical. Ask the user to set uncertainty (or use the Risk tab's ±25% button) first.");
        if (scenarioId(scenario)) throw new ToolError("Monte Carlo runs on the active scenario in the UI; switch scenarios there, or omit scenario for the base model.");
        const r = await ctx.runMonteCarlo({ runs, seed: model().settings.seed });
        if (!r || !r.metrics.mrr) throw new ToolError("Monte Carlo was cancelled or produced no runs.");
        const m = (s: { p10: number; p50: number; p90: number } | null, key: string) => (s ? { p10: fmt(key, s.p10), p50: fmt(key, s.p50), p90: fmt(key, s.p90) } : null);
        return {
          runs: r.completed,
          uncertain_assumptions: r.uncertainParameters.map((p) => p.name),
          final_mrr: m(r.metrics.mrr, "mrr"),
          final_cash: m(r.metrics.cash, "cash"),
          probability_profitable: `${Math.round(r.probabilities.profitability * 100)}%`,
          probability_cash_out: r.probabilities.cashOut === null ? null : `${Math.round(r.probabilities.cashOut * 100)}%`,
          probability_guardrail_broken: r.probabilities.guardrailViolation === null ? null : `${Math.round(r.probabilities.guardrailViolation * 100)}%`,
        };
      },
    }),
    tool({
      name: "get_metric",
      description: "Value of one metric in one period (default: the last period).",
      parameters: z.object({ metric, period: z.number().int().min(1).optional().describe("1-based period number"), scenario: scenarioArg }),
      run: ({ metric: key, period, scenario }) => {
        const r = run(scenario);
        const p = r.timeline[Math.min(period ?? r.timeline.length, r.timeline.length) - 1]!;
        return { metric: key, period: p.period, value: p.metrics[key] ?? null, formatted: fmt(key, p.metrics[key]) };
      },
    }),
    tool({
      name: "get_timeline",
      description: "Values of up to 6 metrics over time.",
      parameters: z.object({ metrics: z.array(metric).min(1).max(6), scenario: scenarioArg, from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional(), every: z.number().int().min(1).max(12).default(1) }),
      run: ({ metrics, scenario, from, to, every }) => {
        const r = run(scenario);
        return r.timeline
          .filter((p) => p.index >= (from ?? 1) && p.index <= (to ?? r.timeline.length) && (p.index - (from ?? 1)) % every === 0)
          .map((p) => ({ period: p.period, ...Object.fromEntries(metrics.map((k) => [k, fmt(k, p.metrics[k])])) }));
      },
    }),
    tool({
      name: "run_sensitivity_analysis",
      description: "Which assumptions matter most for a metric: moves each one ±delta and measures the effect.",
      parameters: z.object({ metric: metric.default("mrr"), delta: z.number().min(0.01).max(0.5).default(0.1), scenario: scenarioArg }),
      run: ({ metric: key, delta, scenario }) => {
        const r = runSensitivity(model(), { metric: key, delta, scenarioId: scenarioId(scenario) });
        return {
          metric: key,
          period: r.periodLabel,
          base: fmt(key, r.baseResult),
          ranking: r.entries
            .filter((e) => e.impact > 0)
            .slice(0, 8)
            .map((e) => ({ assumption: e.name, [`at_minus_${delta * 100}pct`]: fmt(key, e.lowResult), [`at_plus_${delta * 100}pct`]: fmt(key, e.highResult), swing: fmt(key, e.impact) })),
        };
      },
    }),
    tool({
      name: "explain_metric",
      description: "Why a metric has its value: its formula, the nodes that make it up and the upstream causal chain, with engine values.",
      parameters: z.object({ metric, period: z.number().int().min(1).optional(), scenario: scenarioArg }),
      run: ({ metric: key, period, scenario }) => {
        const e = explainMetric(model(), run(scenario), key, period);
        return {
          metric: key,
          period: e.periodLabel,
          value: fmt(key, e.value),
          formula: e.formula,
          components: e.components.map((c) => ({ node: c.label, value: c.value })),
          causal_chain: e.drivers.map((d) => ({ node: d.label, value: d.value, steps_away: d.depth })),
        };
      },
    }),
    tool({
      name: "find_bottleneck",
      description: "Find the biggest problems: broken guardrails (with causes), capacity limits, cash-out, largest costs.",
      parameters: z.object({ scenario: scenarioArg }),
      run: ({ scenario }) => {
        const r = run(scenario);
        const m = model();
        const last = r.timeline[r.timeline.length - 1]!;
        const costs = m.nodes
          .filter((n) => n.type === "COST")
          .map((n) => ({ label: n.label, value: last.nodes[n.id]?.out ?? 0 }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 3);
        return {
          guardrails: r.guardrails
            .filter((g) => !g.passed)
            .map((g) => {
              const e = explainGuardrail(m, r, g.guardrailId, g.violations[0]!);
              return { guardrail: m.guardrails.find((x) => x.id === g.guardrailId)?.label, periods_broken: g.violations.length, first: r.timeline[g.violations[0]! - 1]!.period, cause: e.cause, details: e.details };
            }),
          capacity: r.events.filter((e) => e.type === "capacity_exceeded").slice(0, 5).map((e) => `${r.timeline[e.period - 1]!.period}: ${e.message}`),
          cash_out: r.summary.cashOutPeriod ? r.timeline[r.summary.cashOutPeriod - 1]!.period : null,
          largest_costs_final_period: costs.map((c) => ({ cost: c.label, value: fmt("cogs", c.value) })),
        };
      },
    }),
  ];
  return tools as AgentTool<never>[];
}

function tool<S extends z.ZodType>(t: { name: string; description: string; parameters: S; run(args: z.output<S>): unknown }): AgentTool<z.output<S>> {
  return t as AgentTool<z.output<S>>;
}

