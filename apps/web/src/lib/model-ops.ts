/**
 * Pure, immutable model-editing operations used by the editor store.
 * No React here — everything is unit-testable.
 */
import {
  findOutput,
  findSlot,
  ModelSchema,
  NODE_CATALOG,
  NodeSchema,
  slotsFor,
  type Connection,
  type Model,
  type ModelNode,
  type Parameter,
  type SimulationSettings,
  type SlotSpec,
} from "@fin/model-schema";
import { DependencyGraph } from "@fin/simulation-engine";
import { newId } from "./ids";
import type { NodePreset } from "./presets";

export interface XY {
  x: number;
  y: number;
}

export function createBlankModel(name = "Untitled model", id = newId("m")): Model {
  return ModelSchema.parse({
    id,
    name,
    settings: { startDate: defaultStartDate(), timeStep: "monthly", horizon: 24, seed: 1, currency: "USD" },
    nodes: [],
    metadata: { createdAt: new Date().toISOString() },
  });
}

function defaultStartDate(): string {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function uniqueLabel(model: Model, label: string): string {
  const taken = new Set(model.nodes.map((n) => n.label));
  if (!taken.has(label)) return label;
  let i = 2;
  while (taken.has(`${label} ${i}`)) i++;
  return `${label} ${i}`;
}

function guessUnit(slot: SlotSpec, model: Model): string {
  if (slot.kind === "rate") return "percent";
  if (slot.kind === "money") return model.settings.currency;
  if (slot.kind === "count") return "customers";
  return "number";
}

export function addNode(model: Model, preset: NodePreset, position: XY): { model: Model; nodeId: string } {
  const nodeId = newId("n");
  const label = uniqueLabel(model, preset.label);
  const parameters: Parameter[] = [];
  const bindings: Record<string, string> = {};
  for (const p of preset.params) {
    const id = newId("p");
    const unit = p.unit === "USD" && model.settings.currency === "INR" ? "INR" : p.unit.replace(/^USD\//, `${model.settings.currency}/`);
    parameters.push({ id, name: `${label}: ${p.name}`, value: p.value, unit, min: p.min, max: p.max, source: "user", status: "accepted" });
    bindings[p.slot] = id;
  }
  const node = NodeSchema.parse({
    id: nodeId,
    type: preset.type,
    label,
    description: preset.description,
    parameters: bindings,
    config: preset.config ? structuredClone(preset.config) : undefined,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    unit: preset.unit,
  });
  const next = { ...model, nodes: [...model.nodes, node], parameters: [...model.parameters, ...parameters] };
  return { model: normalizeBindings(next), nodeId };
}

/**
 * Keeps node ↔ parameter bindings consistent after structural edits:
 * - drops bindings for slots that no longer exist or are now connected,
 * - creates missing assumptions for required rate/money/setting slots (value 0),
 * - removes assumptions no node uses, and scenario overrides that point at them.
 */
export function normalizeBindings(model: Model): Model {
  const connected = new Set(model.connections.map((c) => `${c.target}:${c.targetPort}`));
  const created: Parameter[] = [];
  const nodes = model.nodes.map((node) => {
    const bindings: Record<string, string> = {};
    for (const [slotName, pid] of Object.entries(node.parameters)) {
      const spec = findSlot(node, slotName);
      if (spec?.parameter && !connected.has(`${node.id}:${slotName}`)) bindings[slotName] = pid;
    }
    for (const spec of slotsFor(node)) {
      const needsValue = spec.required && spec.default === undefined && (spec.kind === "rate" || spec.kind === "money" || !spec.connectable);
      if (spec.parameter && needsValue && !bindings[spec.name] && !connected.has(`${node.id}:${spec.name}`)) {
        const id = newId("p");
        created.push({ id, name: `${node.label}: ${spec.label}`, value: 0, unit: guessUnit(spec, model), source: "user", status: "accepted" });
        bindings[spec.name] = id;
      }
    }
    const same = Object.keys(bindings).length === Object.keys(node.parameters).length && Object.entries(bindings).every(([k, v]) => node.parameters[k] === v);
    return same ? node : { ...node, parameters: bindings };
  });
  const used = new Set(nodes.flatMap((n) => Object.values(n.parameters)));
  const parameters = [...model.parameters, ...created].filter((p) => used.has(p.id));
  const scenarios = model.scenarios.map((s) => ({ ...s, overrides: s.overrides.filter((o) => used.has(o.parameterId)) }));
  return { ...model, nodes, parameters, scenarios };
}

export function updateNode(model: Model, nodeId: string, patch: { label?: string; description?: string; unit?: string; config?: unknown }): Model {
  const nodes = model.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const merged = { ...n, ...patch, config: patch.config === undefined ? n.config : patch.config };
    const parsed = NodeSchema.safeParse(merged);
    return parsed.success ? parsed.data : n;
  });
  const next = { ...model, nodes };
  // Slots may change with config (cost type, split branches, formula variables): drop connections to removed slots.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const connections = next.connections.filter((c) => {
    const t = byId.get(c.target);
    const s = byId.get(c.source);
    return !!t && !!s && !!findSlot(t, c.targetPort) && !!findOutput(s, c.sourcePort);
  });
  return normalizeBindings({ ...next, connections });
}

export function removeElements(model: Model, nodeIds: Iterable<string>, connectionIds: Iterable<string> = []): Model {
  const nodes = new Set(nodeIds);
  const conns = new Set(connectionIds);
  if (nodes.size === 0 && conns.size === 0) return model;
  return normalizeBindings({
    ...model,
    nodes: model.nodes.filter((n) => !nodes.has(n.id)),
    connections: model.connections.filter((c) => !conns.has(c.id) && !nodes.has(c.source) && !nodes.has(c.target)),
  });
}

export type ConnectRequest = Pick<Connection, "source" | "sourcePort" | "target" | "targetPort">;

export function canConnect(model: Model, req: ConnectRequest): { ok: true } | { ok: false; reason: string } {
  const source = model.nodes.find((n) => n.id === req.source);
  const target = model.nodes.find((n) => n.id === req.target);
  if (!source || !target) return { ok: false, reason: "Both ends must be nodes." };
  if (source.id === target.id) return { ok: false, reason: "A node cannot connect to itself." };
  if (!findOutput(source, req.sourcePort)) return { ok: false, reason: `${source.label} has no output "${req.sourcePort}".` };
  const slot = findSlot(target, req.targetPort);
  if (!slot) return { ok: false, reason: `${target.label} has no input "${req.targetPort}".` };
  if (!slot.connectable) return { ok: false, reason: `"${slot.label}" is set as an assumption, not connected.` };
  if (model.connections.some((c) => c.source === req.source && c.sourcePort === req.sourcePort && c.target === req.target && c.targetPort === req.targetPort)) {
    return { ok: false, reason: "These are already connected." };
  }
  const candidate = withConnection(model, req);
  const cycle = DependencyGraph.fromModel(candidate).findCycle();
  if (cycle) {
    const labels = cycle.map((id) => model.nodes.find((n) => n.id === id)?.label ?? id);
    return { ok: false, reason: `Circular dependency detected. ${labels.join(" → ")}` };
  }
  return { ok: true };
}

/** Adds a connection. A single-input slot that is already connected gets its old connection replaced. */
function withConnection(model: Model, req: ConnectRequest): Model {
  const target = model.nodes.find((n) => n.id === req.target);
  const single = target ? !findSlot(target, req.targetPort)?.multiple : true;
  const kept = single ? model.connections.filter((c) => !(c.target === req.target && c.targetPort === req.targetPort)) : model.connections;
  return { ...model, connections: [...kept, { id: newId("c"), ...req }] };
}

export function connect(model: Model, req: ConnectRequest): Model {
  const check = canConnect(model, req);
  if (!check.ok) throw new Error(check.reason);
  return normalizeBindings(withConnection(model, req));
}

export function moveNodes(model: Model, positions: Readonly<Record<string, XY>>): Model {
  return { ...model, nodes: model.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)) };
}

export interface Fragment {
  nodes: ModelNode[];
  connections: Connection[];
  parameters: Parameter[];
}

export function copyFragment(model: Model, nodeIds: Iterable<string>): Fragment {
  const ids = new Set(nodeIds);
  const nodes = model.nodes.filter((n) => ids.has(n.id));
  const paramIds = new Set(nodes.flatMap((n) => Object.values(n.parameters)));
  return structuredClone({
    nodes,
    connections: model.connections.filter((c) => ids.has(c.source) && ids.has(c.target)),
    parameters: model.parameters.filter((p) => paramIds.has(p.id)),
  });
}

export function pasteFragment(model: Model, fragment: Fragment, offset: XY = { x: 40, y: 40 }): { model: Model; nodeIds: string[] } {
  const nodeMap = new Map(fragment.nodes.map((n) => [n.id, newId("n")]));
  const paramMap = new Map(fragment.parameters.map((p) => [p.id, newId("p")]));
  let working = model;
  const nodes: ModelNode[] = fragment.nodes.map((n) => {
    const label = uniqueLabel(working, n.label);
    const node = {
      ...structuredClone(n),
      id: nodeMap.get(n.id)!,
      label,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      parameters: Object.fromEntries(Object.entries(n.parameters).map(([slot, pid]) => [slot, paramMap.get(pid) ?? pid])),
    } as ModelNode;
    working = { ...working, nodes: [...working.nodes, node] };
    return node;
  });
  const parameters = fragment.parameters.map((p) => ({ ...structuredClone(p), id: paramMap.get(p.id)! }));
  const connections = fragment.connections.map((c) => ({ ...c, id: newId("c"), source: nodeMap.get(c.source)!, target: nodeMap.get(c.target)! }));
  const next = normalizeBindings({
    ...model,
    nodes: [...model.nodes, ...nodes],
    parameters: [...model.parameters, ...parameters],
    connections: [...model.connections, ...connections],
  });
  return { model: next, nodeIds: nodes.map((n) => n.id) };
}

export function updateParameter(model: Model, parameterId: string, patch: Partial<Omit<Parameter, "id">>): Model {
  return { ...model, parameters: model.parameters.map((p) => (p.id === parameterId ? { ...p, ...patch } : p)) };
}

/** Creates an assumption for an unconnected slot so it can be edited directly. */
export function bindNewParameter(model: Model, nodeId: string, slotName: string): Model {
  const node = model.nodes.find((n) => n.id === nodeId);
  const slot = node ? findSlot(node, slotName) : undefined;
  if (!node || !slot || !slot.parameter || node.parameters[slotName]) return model;
  const id = newId("p");
  const param: Parameter = { id, name: `${node.label}: ${slot.label}`, value: slot.default ?? 0, unit: guessUnit(slot, model), source: "user", status: "accepted" };
  return {
    ...model,
    parameters: [...model.parameters, param],
    nodes: model.nodes.map((n) => (n.id === nodeId ? { ...n, parameters: { ...n.parameters, [slotName]: id } } : n)),
  };
}

/** Removes a slot's direct value so it falls back to its default (optional slots only). */
export function unbindParameter(model: Model, nodeId: string, slotName: string): Model {
  return normalizeBindings({
    ...model,
    nodes: model.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const { [slotName]: _removed, ...rest } = n.parameters;
      return { ...n, parameters: rest };
    }),
  });
}

export function updateModelInfo(model: Model, patch: { name?: string; description?: string }): Model {
  return { ...model, ...patch };
}

export function updateSettings(model: Model, patch: Partial<SimulationSettings>): Model {
  return { ...model, settings: { ...model.settings, ...patch } };
}

export function nodeTypeLabel(node: ModelNode): string {
  return NODE_CATALOG[node.type].label;
}
