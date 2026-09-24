import type { BusinessStage, ModelInput, ModelNodeInput, ParameterInput } from "@fin/model-schema";

type NodeOpts = {
  params?: Record<string, string>;
  config?: Record<string, unknown>;
  unit?: string;
  description?: string;
};

/**
 * Small declarative helper for writing templates. Templates only compose the
 * engine's generic node types; nothing template-specific reaches the engine.
 */
export class GraphBuilder {
  private readonly parameters: ParameterInput[] = [];
  private readonly nodes: ModelNodeInput[] = [];
  private readonly connections: NonNullable<ModelInput["connections"]> = [];

  /** Adds an assumption. Template values are examples and are labelled as such. */
  p(id: string, name: string, value: number, unit: string, extra: Partial<ParameterInput> = {}): string {
    this.parameters.push({ id, name, value, unit, source: "template", description: "Example value from the template. Replace it with your own.", ...extra });
    return id;
  }

  node(id: string, type: ModelNodeInput["type"], label: string, [col, row]: [number, number], opts: NodeOpts = {}): string {
    this.nodes.push({
      id,
      type,
      label,
      position: { x: Math.round(col * 260), y: Math.round(row * 150) },
      parameters: opts.params ?? {},
      ...(opts.config ? { config: opts.config } : {}),
      ...(opts.unit ? { unit: opts.unit } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    } as ModelNodeInput);
    return id;
  }

  link(from: string, to: string, targetPort: string, sourcePort = "out"): void {
    this.connections.push({ id: `c${this.connections.length + 1}`, source: from, sourcePort, target: to, targetPort });
  }

  build(model: Omit<ModelInput, "nodes" | "connections" | "parameters"> & { stage?: BusinessStage }): ModelInput {
    const { stage, ...rest } = model;
    return {
      ...rest,
      nodes: this.nodes,
      connections: this.connections,
      parameters: this.parameters,
      metadata: { ...(rest.metadata ?? {}), ...(stage ? { stage } : {}) },
    };
  }
}

export const SETTINGS = (horizon = 24): ModelInput["settings"] => ({ startDate: nextMonth(), timeStep: "monthly", horizon, seed: 42, currency: "USD" });

function nextMonth(): string {
  const d = new Date();
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const cost = (costType: "fixed" | "variable" | "percentage" | "step" | "capacity", costClass: "cogs" | "opex", category: string) => ({ costType, costClass, category });
