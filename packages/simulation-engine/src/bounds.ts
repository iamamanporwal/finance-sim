import { findSlot, type Model } from "@fin/model-schema";

export interface Bounds {
  min?: number;
  max?: number;
}

/**
 * Valid range for each parameter: its own min/max intersected with the range
 * of every slot it is bound to (e.g. a conversion rate must stay within 0–100%).
 * Used to clamp sampled or perturbed values so they never make the model invalid.
 */
export function parameterBounds(model: Model): Map<string, Bounds> {
  const bounds = new Map<string, Bounds>(model.parameters.map((p) => [p.id, { min: p.min, max: p.max }]));
  for (const node of model.nodes) {
    for (const [slotName, pid] of Object.entries(node.parameters)) {
      const range = findSlot(node, slotName)?.range;
      const b = bounds.get(pid);
      if (!range || !b) continue;
      if (range.min !== undefined) b.min = b.min === undefined ? range.min : Math.max(b.min, range.min);
      if (range.max !== undefined) b.max = b.max === undefined ? range.max : Math.min(b.max, range.max);
    }
  }
  return bounds;
}

export function clamp(value: number, b: Bounds | undefined): number {
  if (!b) return value;
  let v = value;
  if (b.min !== undefined && v < b.min) v = b.min;
  if (b.max !== undefined && v > b.max) v = b.max;
  return v;
}

/** Parameters that some node actually uses. */
export function boundParameterIds(model: Model): string[] {
  const used = new Set(model.nodes.flatMap((n) => Object.values(n.parameters)));
  return model.parameters.filter((p) => used.has(p.id)).map((p) => p.id);
}
