import { findSlot, type Distribution, type Model, type Parameter } from "@fin/model-schema";
import { parameterBounds } from "@fin/simulation-engine";

/**
 * Beginner-friendly uncertainty: a level maps to a symmetric triangular
 * distribution around the value (± 10% / 25% / 50%). Advanced users edit the
 * distribution directly, which shows up as "Custom".
 */
export const UNCERTAINTY_LEVELS = { none: 0, low: 0.1, medium: 0.25, high: 0.5 } as const;
export type UncertaintyLevel = keyof typeof UNCERTAINTY_LEVELS | "custom";

export const UNCERTAINTY_LABELS: Record<UncertaintyLevel, string> = {
  none: "None (fixed)",
  low: "Low (±10%)",
  medium: "Medium (±25%)",
  high: "High (±50%)",
  custom: "Custom",
};

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export function uncertaintyLevel(p: Pick<Parameter, "value" | "distribution">): UncertaintyLevel {
  const d = p.distribution;
  if (!d || d.type === "fixed") return "none";
  if (d.type !== "triangular" || !close(d.mode, p.value) || p.value === 0) return "custom";
  for (const [level, r] of Object.entries(UNCERTAINTY_LEVELS)) {
    if (r === 0) continue;
    const spread = Math.abs(p.value) * r;
    // Allow clamping at the bounds (e.g. a rate that cannot exceed 100%).
    if ((close(d.max - d.mode, spread) || close(d.mode - d.min, spread)) && d.max - d.mode <= spread + 1e-12 && d.mode - d.min <= spread + 1e-12) {
      return level as UncertaintyLevel;
    }
  }
  return "custom";
}

export function distributionForLevel(
  value: number,
  level: Exclude<UncertaintyLevel, "custom">,
  bounds: { min?: number; max?: number } = {},
): Distribution | undefined {
  const r = UNCERTAINTY_LEVELS[level];
  if (r === 0 || value === 0) return undefined;
  const spread = Math.abs(value) * r;
  const clamp = (x: number) => Math.min(bounds.max ?? Infinity, Math.max(bounds.min ?? -Infinity, x));
  return { type: "triangular", min: clamp(value - spread), mode: value, max: clamp(value + spread) };
}

/**
 * Adds Medium (±25%) uncertainty to every driver without one: rates, prices and
 * per-unit costs. Starting balances (initial cash/customers) stay fixed because
 * they are known today.
 */
export function applyDefaultUncertainty(model: Model): Model {
  const bounds = parameterBounds(model);
  const targets = new Set<string>();
  for (const node of model.nodes) {
    for (const [slotName, pid] of Object.entries(node.parameters)) {
      const slot = findSlot(node, slotName);
      if (!slot || slotName === "initial") continue;
      if (slot.kind === "rate" || slot.kind === "money") targets.add(pid);
    }
  }
  return {
    ...model,
    parameters: model.parameters.map((p) =>
      targets.has(p.id) && (!p.distribution || p.distribution.type === "fixed") && p.value !== 0
        ? { ...p, distribution: distributionForLevel(p.value, "medium", bounds.get(p.id)) }
        : p,
    ),
  };
}
