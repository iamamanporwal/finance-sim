import { z } from "zod";

/**
 * The assumptions the AI may extract from a business description. A fixed
 * vocabulary keeps extraction reliable with local models; the deterministic
 * builder turns it into a node graph.
 */
export interface AssumptionDef {
  key: string;
  label: string;
  /** Meaning shown to the AI and the user. */
  help: string;
  unit: string;
  kind: "rate" | "money" | "count";
  min?: number;
  max?: number;
}

export const ASSUMPTIONS = [
  { key: "visitors", label: "Visitors or signups per month", help: "Top-of-funnel people per month at the start (visitors, trials or signups).", unit: "users", kind: "count", min: 0 },
  { key: "growth", label: "Monthly growth", help: "Monthly growth rate of visitors/signups, as a fraction (15% = 0.15).", unit: "percent", kind: "rate", min: -1, max: 10 },
  { key: "conversion", label: "Conversion rate", help: "Fraction of visitors/signups that become paying customers (7% = 0.07).", unit: "percent", kind: "rate", min: 0, max: 1 },
  { key: "price", label: "Price per customer per month", help: "Average subscription price per paying customer per month.", unit: "USD/customers", kind: "money", min: 0 },
  { key: "churn", label: "Monthly churn", help: "Fraction of paying customers lost each month (5% = 0.05).", unit: "percent", kind: "rate", min: 0, max: 1 },
  { key: "cogsPerCustomer", label: "Cost to serve per customer per month", help: "COGS per paying customer per month (hosting, AI tokens, support).", unit: "USD/customers", kind: "money", min: 0 },
  { key: "paymentFeeRate", label: "Payment processing fee", help: "Fraction of revenue paid to the payment processor (2.9% = 0.029).", unit: "percent", kind: "rate", min: 0, max: 1 },
  { key: "fixedCosts", label: "Fixed costs per month", help: "Monthly fixed costs such as rent and software (excluding payroll).", unit: "USD", kind: "money", min: 0 },
  { key: "payroll", label: "Payroll per month", help: "Total monthly salaries.", unit: "USD", kind: "money", min: 0 },
  { key: "marketingBudget", label: "Marketing budget per month", help: "Paid acquisition spend per month.", unit: "USD", kind: "money", min: 0 },
  { key: "cac", label: "Customer acquisition cost (CAC)", help: "Cost to acquire one paying customer through paid marketing.", unit: "USD", kind: "money", min: 0 },
  { key: "startingCustomers", label: "Current paying customers", help: "Paying customers today.", unit: "customers", kind: "count", min: 0 },
  { key: "startingCash", label: "Cash in the bank", help: "Cash available today.", unit: "USD", kind: "money", min: 0 },
  { key: "usagePerCustomer", label: "Usage units per customer per month", help: "Billable usage units (API calls, credits) per customer per month.", unit: "units", kind: "count", min: 0 },
  { key: "usagePrice", label: "Price per usage unit", help: "Price charged per billable usage unit.", unit: "USD/units", kind: "money", min: 0 },
] as const satisfies readonly AssumptionDef[];

export type AssumptionKey = (typeof ASSUMPTIONS)[number]["key"];
export const ASSUMPTION_KEYS = ASSUMPTIONS.map((a) => a.key) as [AssumptionKey, ...AssumptionKey[]];
export const assumptionDef = (key: string): AssumptionDef | undefined => ASSUMPTIONS.find((a) => a.key === key);

export const ExtractedAssumptionSchema = z.object({
  key: z.enum(ASSUMPTION_KEYS),
  value: z.number(),
  /** "user" = stated or directly implied in the description; "ai" = suggested by the AI. */
  source: z.enum(["user", "ai"]),
  confidence: z.enum(["high", "medium", "low"]),
  /** Quote from the description (user) or a short reason (ai). */
  evidence: z.string().max(300).optional(),
});

export const BusinessSpecSchema = z.object({
  name: z.string().min(1).max(120),
  businessType: z.enum(["saas", "ai-saas", "usage-saas", "marketplace", "api", "other"]),
  summary: z.string().max(600),
  assumptions: z.array(ExtractedAssumptionSchema).max(30),
  /** The most important missing information, as questions for the user. */
  questions: z.array(z.string().max(300)).max(5),
});

export type ExtractedAssumption = z.infer<typeof ExtractedAssumptionSchema>;
export type BusinessSpec = z.infer<typeof BusinessSpecSchema>;

export const BUSINESS_SPEC_JSON_SCHEMA = z.toJSONSchema(BusinessSpecSchema) as Record<string, unknown>;

/** Schema + domain rules. Error messages are written for the AI repair loop. */
export function validateBusinessSpec(json: unknown): { ok: true; value: BusinessSpec } | { ok: false; errors: string[] } {
  const parsed = BusinessSpecSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const a of parsed.data.assumptions) {
    const def = assumptionDef(a.key)!;
    if (seen.has(a.key)) errors.push(`assumption "${a.key}" appears more than once; keep one.`);
    seen.add(a.key);
    if (!Number.isFinite(a.value)) errors.push(`${a.key}: value must be a finite number.`);
    if (def.min !== undefined && a.value < def.min) errors.push(`${a.key}: must be at least ${def.min} (got ${a.value}).`);
    if (def.max !== undefined && a.value > def.max) {
      errors.push(def.kind === "rate" ? `${a.key}: must be a fraction${def.max === 1 ? " between 0 and 1" : ""} (7% = 0.07), got ${a.value}.` : `${a.key}: must be at most ${def.max} (got ${a.value}).`);
    }
  }
  if (seen.has("marketingBudget") && !seen.has("cac")) errors.push("marketingBudget needs cac too (cost per acquired customer); add cac as an AI suggestion with low confidence, or remove marketingBudget.");
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed.data };
}

/** What the builder still needs from the user. */
export function missingEssentials(values: Partial<Record<AssumptionKey, number>>): string[] {
  const missing: string[] = [];
  if (values.price === undefined && values.usagePrice === undefined) missing.push("price");
  const hasFunnel = values.visitors !== undefined && values.conversion !== undefined;
  const hasPaid = values.marketingBudget !== undefined && values.cac !== undefined;
  if (!hasFunnel && !hasPaid && values.startingCustomers === undefined) {
    if (values.visitors === undefined) missing.push("visitors");
    if (values.conversion === undefined) missing.push("conversion");
  } else if (values.visitors !== undefined && values.conversion === undefined) missing.push("conversion");
  if (values.usagePerCustomer !== undefined && values.usagePrice === undefined) missing.push("usagePrice");
  return missing;
}
