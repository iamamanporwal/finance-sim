import type { ModelInput } from "./types";

/**
 * The acceptance-test model from the plan (Phase 4):
 *
 *   Signups 800/mo → Growth 20% → Conversion 7% → Customers (churn 5%) → Revenue ($39)
 *   Customers → COGS ($8/customer) · Fixed costs $20,000/mo · Starting cash $500,000
 */
export function acceptanceModel(): ModelInput {
  return {
    id: "acceptance",
    name: "Acceptance model",
    description: "Simple subscription SaaS used to verify the financial engine.",
    settings: { startDate: "2027-01", timeStep: "monthly", horizon: 24, seed: 42, currency: "USD" },
    parameters: [
      { id: "p_signups", name: "Starting signups", value: 800, unit: "users", source: "user" },
      { id: "p_growth", name: "Signup growth", value: 0.2, unit: "percent", source: "user", min: 0, max: 1 },
      { id: "p_conversion", name: "Conversion rate", value: 0.07, unit: "percent", source: "user" },
      { id: "p_price", name: "Price", value: 39, unit: "USD", source: "user" },
      { id: "p_churn", name: "Monthly churn", value: 0.05, unit: "percent", source: "user" },
      { id: "p_cogs", name: "COGS per customer", value: 8, unit: "USD/customers", source: "user" },
      { id: "p_fixed", name: "Fixed costs", value: 20000, unit: "USD", source: "user" },
      { id: "p_cash", name: "Starting cash", value: 500000, unit: "USD", source: "user" },
    ],
    nodes: [
      { id: "signups", type: "INPUT", label: "Signups", unit: "users", parameters: { value: "p_signups" }, position: { x: 0, y: 40 } },
      { id: "growth", type: "GROWTH", label: "Signup growth", unit: "users", parameters: { rate: "p_growth" }, position: { x: 260, y: 40 } },
      { id: "conversion", type: "CONVERSION", label: "Conversion", unit: "customers", parameters: { rate: "p_conversion" }, position: { x: 520, y: 40 } },
      { id: "churn", type: "CHURN", label: "Churn", parameters: { rate: "p_churn" }, position: { x: 520, y: 240 } },
      { id: "customers", type: "CUSTOMERS", label: "Customers", unit: "customers", position: { x: 780, y: 120 } },
      { id: "price", type: "PRICE", label: "Price", unit: "USD", parameters: { price: "p_price" }, position: { x: 780, y: 340 } },
      { id: "revenue", type: "REVENUE", label: "Subscription revenue", unit: "USD", config: { revenueType: "subscription" }, position: { x: 1040, y: 200 } },
      {
        id: "cogs",
        type: "COST",
        label: "COGS",
        unit: "USD",
        parameters: { unitCost: "p_cogs" },
        config: { costType: "variable", costClass: "cogs", category: "infrastructure" },
        position: { x: 1040, y: 400 },
      },
      {
        id: "fixed",
        type: "COST",
        label: "Fixed costs",
        unit: "USD",
        parameters: { amount: "p_fixed" },
        config: { costType: "fixed", costClass: "opex", category: "other" },
        position: { x: 1040, y: 580 },
      },
      { id: "cash", type: "CASH", label: "Cash", unit: "USD", parameters: { initial: "p_cash" }, position: { x: 1300, y: 380 } },
    ],
    connections: [
      { id: "c1", source: "signups", target: "growth", targetPort: "base" },
      { id: "c2", source: "growth", target: "conversion", targetPort: "input" },
      { id: "c3", source: "conversion", target: "customers", targetPort: "new" },
      { id: "c4", source: "churn", target: "customers", targetPort: "churnRate" },
      { id: "c5", source: "customers", target: "revenue", targetPort: "quantity" },
      { id: "c6", source: "price", target: "revenue", targetPort: "price" },
      { id: "c7", source: "customers", target: "cogs", targetPort: "volume" },
      { id: "c8", source: "revenue", target: "cash", targetPort: "inflow" },
      { id: "c9", source: "cogs", target: "cash", targetPort: "outflow" },
      { id: "c10", source: "fixed", target: "cash", targetPort: "outflow" },
    ],
    scenarios: [
      { id: "base", name: "Base", kind: "base" },
      { id: "slow", name: "Slow growth", kind: "downside", overrides: [{ parameterId: "p_growth", value: 0.1 }] },
    ],
    guardrails: [
      { id: "g_margin", label: "Gross margin > 55%", metric: "grossMargin", operator: ">", threshold: 0.55 },
      { id: "g_cash", label: "Cash > $0", metric: "cash", operator: ">", threshold: 0, severity: "critical" },
    ],
  };
}
