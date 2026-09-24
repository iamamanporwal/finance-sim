import { findOutput, outputsFor, slotsFor } from "./catalog";
import type { Model, ModelNode } from "./types";

export const NODE_WIDTH = 220;
const COLUMN_GAP = 90;
const ROW_GAP = 36;

/** Approximate rendered height of a node on the canvas (header, port rows, assumptions, value footer). */
export function estimateNodeHeight(node: ModelNode): number {
  const rows = Math.max(slotsFor(node).filter((s) => s.connectable).length, outputsFor(node).length);
  const assumptions = Math.min(3, Object.keys(node.parameters).length);
  return 36 + rows * 22 + 8 + (assumptions ? assumptions * 17 + 10 : 0) + 28;
}

/**
 * Left-to-right layered layout: each node's column is its longest same-period
 * dependency path; within a column nodes are ordered by their inputs' positions
 * (fewer crossings) and placed near them without overlapping.
 */
export function autoLayout(model: Pick<Model, "nodes" | "connections">): Map<string, { x: number; y: number }> {
  const ids = model.nodes.map((n) => n.id);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const c of model.connections) {
    const s = byId.get(c.source);
    if (!s || !byId.has(c.target) || c.source === c.target) continue;
    // Feedback through a stock's opening balance is drawn backwards, not as a new column.
    if (findOutput(s, c.sourcePort)?.lagged) continue;
    preds.get(c.target)!.push(c.source);
    succs.get(c.source)!.push(c.target);
  }

  // Longest-path layering (bounded, so an invalid cyclic graph still terminates).
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const id of ids) {
      for (const p of preds.get(id)!) {
        if (layer.get(p)! + 1 > layer.get(id)!) {
          layer.set(id, layer.get(p)! + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Pull pure sources next to their first consumer so inputs sit beside what they feed.
  for (const id of ids) {
    const out = succs.get(id)!;
    if (preds.get(id)!.length === 0 && out.length > 0) layer.set(id, Math.max(0, Math.min(...out.map((s) => layer.get(s)!)) - 1));
  }

  const columns: string[][] = [];
  for (const id of ids) (columns[layer.get(id)!] ??= []).push(id);
  const order = new Map<string, number>();
  const bary = (id: string, neighbours: string[]) => (neighbours.length ? neighbours.reduce((s, n) => s + (order.get(n) ?? 0), 0) / neighbours.length : order.get(id) ?? 0);
  const index = () => columns.forEach((col) => col?.forEach((id, i) => order.set(id, i)));
  index();
  for (let sweep = 0; sweep < 4; sweep++) {
    const cols = sweep % 2 === 0 ? columns : [...columns].reverse();
    for (const col of cols) {
      if (!col) continue;
      col.sort((a, b) => bary(a, sweep % 2 === 0 ? preds.get(a)! : succs.get(a)!) - bary(b, sweep % 2 === 0 ? preds.get(b)! : succs.get(b)!));
      col.forEach((id, i) => order.set(id, i));
    }
  }

  const pos = new Map<string, { x: number; y: number }>();
  const center = (id: string) => pos.get(id)!.y + estimateNodeHeight(byId.get(id)!) / 2;
  columns.forEach((col, c) => {
    if (!col) return;
    let bottom = 0;
    for (const id of col) {
      const h = estimateNodeHeight(byId.get(id)!);
      const placed = preds.get(id)!.filter((p) => pos.has(p));
      const desired = placed.length ? placed.reduce((s, p) => s + center(p), 0) / placed.length - h / 2 : bottom;
      const y = Math.max(bottom, Math.round(desired));
      pos.set(id, { x: c * (NODE_WIDTH + COLUMN_GAP), y });
      bottom = y + h + ROW_GAP;
    }
  });
  return pos;
}

/** The model with every node moved to its auto-layout position. */
export function applyAutoLayout<M extends Pick<Model, "nodes" | "connections">>(model: M): M {
  const pos = autoLayout(model);
  return { ...model, nodes: model.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) };
}
