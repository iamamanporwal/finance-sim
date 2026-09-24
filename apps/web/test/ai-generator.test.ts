import { ScriptedProvider } from "@fin/ai";
import { simulate, validateForSimulation } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { buildModelFromAssumptions } from "../src/ai/builder";
import { missingEssentials, validateBusinessSpec, type ExtractedAssumption } from "../src/ai/business-spec";
import { extractBusinessSpec } from "../src/ai/generator";
import { reviewModel } from "../src/ai/review";

const user = (key: ExtractedAssumption["key"], value: number, evidence = "stated"): ExtractedAssumption => ({ key, value, source: "user", confidence: "high", evidence });
const ai = (key: ExtractedAssumption["key"], value: number): ExtractedAssumption => ({ key, value, source: "ai", confidence: "low", evidence: "typical" });

/** Fixed prompt from the plan (Phase 17) and its expected structured output. */
const PLAN_PROMPT = "I run an AI SaaS with 1,000 visitors per month, 5% conversion, $39 pricing, 4% churn and $8 COGS.";
const PLAN_SPEC = {
  name: "AI SaaS",
  businessType: "ai-saas",
  summary: "AI SaaS at $39/month.",
  assumptions: [user("visitors", 1000), user("conversion", 0.05), user("price", 39), user("churn", 0.04), user("cogsPerCustomer", 8), ai("paymentFeeRate", 0.029)],
  questions: ["How much cash do you have?"],
};

describe("business spec validation", () => {
  it("accepts the expected output for the plan's prompt", () => {
    expect(validateBusinessSpec(PLAN_SPEC).ok).toBe(true);
  });
  it("explains percentage mistakes so the AI can repair them", () => {
    const r = validateBusinessSpec({ ...PLAN_SPEC, assumptions: [user("conversion", 5)] });
    expect(r).toEqual({ ok: false, errors: ["conversion: must be a fraction between 0 and 1 (7% = 0.07), got 5."] });
  });
  it("rejects unknown keys, duplicates and a budget without CAC", () => {
    expect(validateBusinessSpec({ ...PLAN_SPEC, assumptions: [{ ...user("price", 1), key: "vibes" }] }).ok).toBe(false);
    const dup = validateBusinessSpec({ ...PLAN_SPEC, assumptions: [user("price", 1), user("price", 2)] });
    expect(dup.ok ? [] : dup.errors).toContain('assumption "price" appears more than once; keep one.');
    const budget = validateBusinessSpec({ ...PLAN_SPEC, assumptions: [user("marketingBudget", 5000)] });
    expect(budget.ok ? [] : budget.errors[0]).toMatch(/marketingBudget needs cac/);
  });
  it("lists essentials that are still missing", () => {
    expect(missingEssentials({ visitors: 1000 })).toEqual(["price", "conversion"]);
    expect(missingEssentials({ startingCustomers: 50, price: 10 })).toEqual([]);
  });
});

describe("extraction with repair (fixed prompt → structured output)", () => {
  it("repairs an invalid first answer", async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ ...PLAN_SPEC, assumptions: [user("conversion", 5), user("price", 39)] }),
      JSON.stringify(PLAN_SPEC),
    ]);
    const r = await extractBusinessSpec({ provider, description: PLAN_PROMPT });
    expect(r.ok).toBe(true);
    expect(r.attempts).toHaveLength(2);
    expect(provider.requests[0]!.messages[1]!.content).toContain(PLAN_PROMPT);
    expect(provider.requests[0]!.jsonSchema).toMatchObject({ type: "object" });
  });
  it("surfaces the problem when the output stays invalid", async () => {
    const bad = JSON.stringify({ name: "" });
    const r = await extractBusinessSpec({ provider: new ScriptedProvider([bad, bad, bad, bad]), description: "x" });
    expect(r.ok).toBe(false);
    expect(r.attempts).toHaveLength(4);
  });
});

describe("deterministic builder", () => {
  it("builds Signups → Conversion → Customers → Price → Revenue and Customers → COGS", () => {
    const m = buildModelFromAssumptions({ name: "AI SaaS", assumptions: PLAN_SPEC.assumptions });
    expect(m.nodes.map((n) => n.label)).toEqual(["Visitors", "Conversion", "Customers", "Churn", "Price", "Subscription revenue", "Cost to serve", "Payment fees"]);
    const v = validateForSimulation(m);
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    const r = simulate(m);
    // 1,000 × 5% × $39 in month 1
    expect(r.timeline[0]!.revenue.total).toBe(1950);
    expect(r.timeline[0]!.costs.cogs).toBeCloseTo(50 * 8 + 1950 * 0.029, 8);
  });
  it("marks AI-suggested assumptions for review and user ones as accepted", () => {
    const m = buildModelFromAssumptions({ name: "AI SaaS", assumptions: PLAN_SPEC.assumptions });
    const fee = m.parameters.find((p) => p.name === "Payment processing fee")!;
    expect(fee).toMatchObject({ source: "ai", status: "pending", confidence: "low", value: 0.029 });
    const price = m.parameters.find((p) => p.name === "Price per customer per month")!;
    expect(price).toMatchObject({ source: "user", status: "accepted", description: "From your description: “stated”" });
    expect(m.parameters.find((p) => p.name === "Customers: Starting customers")!.source).toBe("template");
  });
  it("never invents cash: no Cash node without a starting balance, and the review says so", () => {
    const m = buildModelFromAssumptions({ name: "AI SaaS", assumptions: PLAN_SPEC.assumptions });
    expect(m.nodes.some((n) => n.type === "CASH")).toBe(false);
    const review = reviewModel(m);
    expect(review.items.find((i) => i.label === "Starting cash defined")!.ok).toBe(false);
    expect(review.items.find((i) => i.label === "Payroll or fixed costs defined")!.ok).toBe(false);
    expect(review.pendingAssumptions).toBe(1);
    expect(review.confidence).toBe("Medium");
  });
  it("builds a complete model with growth, marketing, usage, payroll and cash", () => {
    const m = buildModelFromAssumptions({
      name: "Full",
      assumptions: [
        user("visitors", 2000), user("growth", 0.15), user("conversion", 0.05), user("price", 49), user("churn", 0.04), user("cogsPerCustomer", 12),
        user("marketingBudget", 5000), user("cac", 250), user("startingCustomers", 100), user("startingCash", 800000),
        user("usagePerCustomer", 1000), user("usagePrice", 0.002), user("fixedCosts", 8000), user("payroll", 40000), ai("paymentFeeRate", 0.029),
      ],
    });
    const v = validateForSimulation(m);
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(v.issues.filter((i) => i.code === "not-in-cash")).toEqual([]);
    const r = simulate(m);
    const p1 = r.timeline[0]!;
    expect(p1.customers.new).toBeCloseTo(2000 * 0.05 + 5000 / 250, 10);
    expect(p1.revenue.usage).toBeCloseTo(p1.customers.closing * 1000 * 0.002, 8);
    expect(p1.costs.byCategory.payroll).toBe(40000);
    expect(p1.costs.byCategory.marketing).toBe(5000);
    expect(reviewModel(m).items.every((i) => i.ok)).toBe(true);
  });
});
