import { applyAutoLayout, ModelSchema, type BusinessStage, type Model, type ModelInput, type Template } from "@fin/model-schema";
import { hereTemplate } from "./here";
import { aiSaasTemplate, apiTemplate, creditSaasTemplate, marketplaceTemplate, saasTemplate, usageSaasTemplate } from "./simple";

export { GraphBuilder } from "./builder";
export { addCreditEconomy } from "./simple";

export interface TemplateInfo {
  id: string;
  name: string;
  category: Template["category"];
  description: string;
  /** Stages this template suits best (used for recommendations only). */
  stages: BusinessStage[];
  /** Revenue models it covers, for onboarding matching. */
  revenueModels: string[];
  highlights: string[];
  sophisticated?: boolean;
  build(): ModelInput;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: "saas", name: "SaaS subscription", category: "saas", stages: ["pre-launch", "pre-seed", "seed", "growth"], revenueModels: ["subscription"], highlights: ["Visitor funnel", "Monthly plans", "Payment fees"], description: "Visitors convert into monthly subscribers. Hosting, payment fees, payroll and software.", build: saasTemplate },
  { id: "ai-saas", name: "AI SaaS", category: "ai-saas", stages: ["idea", "pre-launch", "pre-seed", "seed"], revenueModels: ["subscription"], highlights: ["Inference cost per customer", "Margin guardrail 55%"], description: "Subscription AI product where every customer drives inference cost.", build: aiSaasTemplate },
  { id: "usage-saas", name: "Usage-based SaaS", category: "usage-saas", stages: ["pre-seed", "seed", "growth"], revenueModels: ["usage", "hybrid"], highlights: ["Platform fee + metered usage", "Usage grows per customer"], description: "Small platform fee plus pay-as-you-go usage.", build: usageSaasTemplate },
  { id: "credit-saas", name: "AI SaaS + subscription + credits", category: "credit-saas", stages: ["pre-seed", "seed", "growth"], revenueModels: ["subscription", "credits", "hybrid"], highlights: ["Credit wallet & top-ups", "Deferred revenue", "Breakage & rationing"], description: "Plans include monthly credits; heavy users buy top-ups, recognized as revenue when used or expired.", build: creditSaasTemplate },
  { id: "marketplace", name: "Marketplace", category: "marketplace", stages: ["pre-seed", "seed", "growth", "scale"], revenueModels: ["take rate", "commission"], highlights: ["GMV × take rate", "Processing on GMV"], description: "Buyers place orders; you keep a take rate on GMV.", build: marketplaceTemplate },
  { id: "api", name: "API business", category: "api", stages: ["pre-launch", "pre-seed", "seed"], revenueModels: ["usage", "hybrid"], highlights: ["Base plan + per-call pricing", "Infrastructure per call"], description: "Developers pay a base plan plus metered API calls.", build: apiTemplate },
  {
    id: "here",
    name: "HERE",
    category: "credit-saas",
    stages: ["seed", "growth", "scale"],
    revenueModels: ["subscription", "credits", "hybrid"],
    highlights: ["Signal · Prime · Studio · World · Dedicated", "Credits, top-ups, breakage", "Guardians, NRR, APG, WSCB"],
    sophisticated: true,
    description: "The full HERE model: free Signal tier, four paid plans with upgrades, a credit economy with revenue recognition, guardians and the complete cost structure.",
    build: hereTemplate,
  },
];

export function findTemplate(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** A new, schema-parsed model from a template with a fresh ID. */
export function instantiateTemplate(id: string, modelId: string, now = new Date().toISOString()): Model {
  const t = findTemplate(id);
  if (!t) throw new Error(`Unknown template "${id}".`);
  const input = t.build();
  // Laid out from the graph itself, so templates never overlap however many ports their nodes have.
  return applyAutoLayout(ModelSchema.parse({ ...input, id: modelId, metadata: { ...input.metadata, templateId: t.id, createdAt: now } }));
}

/** Templates ordered for a stage and revenue model: matches first, sophisticated templates last. */
export function recommendTemplates(stage?: BusinessStage, revenueModel?: string): TemplateInfo[] {
  const score = (t: TemplateInfo) => (stage && t.stages.includes(stage) ? 2 : 0) + (revenueModel && t.revenueModels.includes(revenueModel) ? 3 : 0);
  return [...TEMPLATES].sort((a, b) => score(b) - score(a));
}
