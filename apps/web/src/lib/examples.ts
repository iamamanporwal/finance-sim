import { acceptanceModel, ModelSchema, type Model } from "@fin/model-schema";

export interface StarterExample {
  id: string;
  name: string;
  description: string;
  build(): Model;
}

/** Starter models available before the template library (Phase 26) exists. */
export const STARTER_EXAMPLES: StarterExample[] = [
  {
    id: "subscription-saas",
    name: "Subscription SaaS",
    description: "Signups grow 20%/mo, 7% convert, $39/mo, 5% churn, $8 COGS, $20K fixed costs, $500K cash.",
    build() {
      const m = ModelSchema.parse(acceptanceModel());
      return {
        ...m,
        name: "Subscription SaaS",
        description: "Starter model: signups → conversion → customers → revenue → cash.",
        parameters: m.parameters.map((p) => ({ ...p, source: "template" as const })),
        metadata: { ...m.metadata, templateId: "subscription-saas" },
      };
    },
  },
];

/** Copies an example's contents into an existing model, keeping its identity and name. */
export function applyExample(target: Model, example: StarterExample): Model {
  const ex = example.build();
  return { ...ex, id: target.id, name: target.name === "Untitled model" ? ex.name : target.name, version: target.version, metadata: { ...ex.metadata, createdAt: target.metadata.createdAt } };
}
