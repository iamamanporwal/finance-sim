import type { ModelInput } from "@fin/model-schema";

type P = { id: string; value: number; unit?: string };

/** Compact builder for small test models. */
export function makeModel(
  parts: { nodes: ModelInput["nodes"]; connections?: [string, string, string, string?][]; params?: P[] },
  settings: Partial<ModelInput["settings"]> = {},
): ModelInput {
  return {
    id: "test",
    name: "Test",
    settings: { startDate: "2027-01", timeStep: "monthly", horizon: 6, seed: 1, ...settings },
    parameters: (parts.params ?? []).map((p) => ({ id: p.id, name: p.id, value: p.value, unit: p.unit ?? "number" })),
    nodes: parts.nodes,
    connections: (parts.connections ?? []).map(([source, target, targetPort, sourcePort], i) => ({
      id: `c${i}`,
      source,
      target,
      targetPort,
      sourcePort: sourcePort ?? "out",
    })),
  };
}
