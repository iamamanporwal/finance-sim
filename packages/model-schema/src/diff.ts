import type { Model } from "./types";

export interface ValueChange {
  id: string;
  name: string;
  unit?: string;
  from: number | string | null;
  to: number | string | null;
}

export interface ModelDiff {
  parameters: { changed: ValueChange[]; added: ValueChange[]; removed: ValueChange[] };
  nodes: { added: string[]; removed: string[]; changed: string[] };
  connections: { added: number; removed: number };
  scenarios: { added: string[]; removed: string[]; changed: string[] };
  guardrails: { added: string[]; removed: string[]; changed: string[] };
  customMetrics: { added: string[]; removed: string[]; changed: string[] };
  settings: ValueChange[];
  /** True when nothing that affects results or structure differs. */
  identical: boolean;
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * What changed between two versions of a model ("v1 → v2: Growth 20% → 15%").
 * Positions and timestamps are ignored; they do not change results.
 */
export function diffModels(a: Model, b: Model): ModelDiff {
  const pa = new Map(a.parameters.map((p) => [p.id, p]));
  const pb = new Map(b.parameters.map((p) => [p.id, p]));
  const parameters: ModelDiff["parameters"] = { changed: [], added: [], removed: [] };
  for (const [id, p] of pb) {
    const old = pa.get(id);
    if (!old) parameters.added.push({ id, name: p.name, unit: p.unit, from: null, to: p.value });
    else if (old.value !== p.value || json(old.distribution) !== json(p.distribution) || old.status !== p.status) {
      parameters.changed.push({ id, name: p.name, unit: p.unit, from: old.value, to: p.value });
    }
  }
  for (const [id, p] of pa) if (!pb.has(id)) parameters.removed.push({ id, name: p.name, unit: p.unit, from: p.value, to: null });

  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  const na = byId(a.nodes);
  const nb = byId(b.nodes);
  const strip = (n: Model["nodes"][number]) => ({ ...n, position: undefined });
  const nodes = {
    added: b.nodes.filter((n) => !na.has(n.id)).map((n) => n.label),
    removed: a.nodes.filter((n) => !nb.has(n.id)).map((n) => n.label),
    changed: b.nodes.filter((n) => na.has(n.id) && json(strip(na.get(n.id)!)) !== json(strip(n))).map((n) => n.label),
  };
  const key = (c: Model["connections"][number]) => `${c.source}.${c.sourcePort}>${c.target}.${c.targetPort}`;
  const ca = new Set(a.connections.map(key));
  const cb = new Set(b.connections.map(key));
  const connections = { added: [...cb].filter((k) => !ca.has(k)).length, removed: [...ca].filter((k) => !cb.has(k)).length };

  const named = <T extends { id?: string; key?: string; name?: string; label?: string }>(xs: readonly T[], ys: readonly T[]) => {
    const id = (x: T) => x.id ?? x.key ?? "";
    const name = (x: T) => x.name ?? x.label ?? id(x);
    const mx = new Map(xs.map((x) => [id(x), x]));
    const my = new Map(ys.map((y) => [id(y), y]));
    return {
      added: ys.filter((y) => !mx.has(id(y))).map(name),
      removed: xs.filter((x) => !my.has(id(x))).map(name),
      changed: ys.filter((y) => mx.has(id(y)) && json(mx.get(id(y))) !== json(y)).map(name),
    };
  };
  const settings: ValueChange[] = [];
  for (const k of ["startDate", "timeStep", "horizon", "seed", "currency"] as const) {
    if (a.settings[k] !== b.settings[k]) settings.push({ id: k, name: k, from: a.settings[k], to: b.settings[k] });
  }
  const diff: ModelDiff = {
    parameters,
    nodes,
    connections,
    scenarios: named(a.scenarios, b.scenarios),
    guardrails: named(a.guardrails, b.guardrails),
    customMetrics: named(a.customMetrics, b.customMetrics),
    settings,
    identical: false,
  };
  diff.identical =
    !parameters.changed.length && !parameters.added.length && !parameters.removed.length &&
    !nodes.added.length && !nodes.removed.length && !nodes.changed.length &&
    !connections.added && !connections.removed &&
    [diff.scenarios, diff.guardrails, diff.customMetrics].every((d) => !d.added.length && !d.removed.length && !d.changed.length) &&
    !settings.length && json(a.actuals) === json(b.actuals) && json(a.currentState) === json(b.currentState);
  return diff;
}
