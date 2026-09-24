import type { NodeType } from "@fin/model-schema";

export interface PresetParam {
  slot: string;
  name: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
}

/** A node-library entry: an engine node type plus sensible defaults. */
export interface NodePreset {
  id: string;
  label: string;
  group: LibraryGroup;
  description: string;
  keywords: string[];
  type: NodeType;
  config?: Record<string, unknown>;
  params: PresetParam[];
  unit?: string;
}

export const LIBRARY_GROUPS = ["Inputs", "Customers", "Revenue", "Costs", "Resources", "Logic"] as const;
export type LibraryGroup = (typeof LIBRARY_GROUPS)[number];

const pct = (slot: string, name: string, value: number): PresetParam => ({ slot, name, value, unit: "percent" });
const usd = (slot: string, name: string, value: number, unit = "USD"): PresetParam => ({ slot, name, value, unit, min: 0 });

export const NODE_PRESETS: readonly NodePreset[] = [
  // Inputs
  { id: "input", label: "Input", group: "Inputs", type: "INPUT", description: "A value you control, e.g. monthly signups.", keywords: ["assumption", "value", "number", "signups", "visitors", "traffic"], params: [{ slot: "value", name: "Value", value: 1000, unit: "users" }], unit: "users" },
  { id: "growth", label: "Growth", group: "Inputs", type: "GROWTH", description: "Grow a base value each period.", keywords: ["compound", "increase", "rate", "mom"], config: { growthType: "compound", startPeriod: 1 }, params: [pct("rate", "Monthly growth", 0.1)] },

  // Customers
  { id: "acquisition", label: "Acquisition", group: "Customers", type: "ACQUISITION", description: "Customers from marketing spend ÷ CAC plus organic.", keywords: ["marketing", "cac", "ads", "paid", "organic", "budget"], params: [usd("budget", "Marketing budget", 5000), usd("cac", "CAC", 250), { slot: "organic", name: "Organic customers", value: 0, unit: "customers", min: 0 }], unit: "customers" },
  { id: "conversion", label: "Conversion", group: "Customers", type: "CONVERSION", description: "Share of prospects that become customers.", keywords: ["convert", "funnel", "trial", "rate", "signup"], params: [pct("rate", "Conversion rate", 0.05)], unit: "customers" },
  { id: "customers", label: "Customers", group: "Customers", type: "CUSTOMERS", description: "Customer count that grows with new customers and shrinks with churn.", keywords: ["users", "subscribers", "accounts", "stock", "base"], params: [{ slot: "initial", name: "Starting customers", value: 0, unit: "customers", min: 0 }], unit: "customers" },
  { id: "churn", label: "Churn", group: "Customers", type: "CHURN", description: "Share of customers who leave each month.", keywords: ["cancel", "retention", "attrition", "leave", "loss"], config: { basis: "per_period" }, params: [pct("rate", "Monthly churn", 0.05)] },
  { id: "upgrade", label: "Upgrade", group: "Customers", type: "CONVERSION", description: "Move a share of a plan's customers to a higher plan. Wire: plan opening → Upgrade → higher plan “moved in”, and → this plan “moved out”.", keywords: ["expansion", "upsell", "move", "plan"], params: [pct("rate", "Upgrade rate", 0.02)], unit: "customers" },
  { id: "downgrade", label: "Downgrade", group: "Customers", type: "CONVERSION", description: "Move a share of a plan's customers to a lower plan. Wire: plan opening → Downgrade → lower plan “moved in”, and → this plan “moved out”.", keywords: ["contraction", "move", "plan"], params: [pct("rate", "Downgrade rate", 0.01)], unit: "customers" },
  { id: "split", label: "Split", group: "Customers", type: "SPLIT", description: "Split a flow across plans. Shares must total 100%.", keywords: ["plan mix", "branch", "segment", "tiers", "distribution"], config: { branches: [{ key: "planA", label: "Plan A" }, { key: "planB", label: "Plan B" }] }, params: [pct("weight.planA", "Plan A share", 0.8), pct("weight.planB", "Plan B share", 0.2)] },

  // Revenue
  { id: "price", label: "Price", group: "Revenue", type: "PRICE", description: "Price per customer per month, after discount.", keywords: ["pricing", "arpu", "plan", "fee", "subscription price"], params: [usd("price", "Price", 39, "USD/customers"), pct("discount", "Discount", 0)], unit: "USD" },
  { id: "subscription", label: "Subscription", group: "Revenue", type: "REVENUE", description: "Recurring revenue: customers × price (counts toward MRR).", keywords: ["mrr", "recurring", "revenue", "saas"], config: { revenueType: "subscription" }, params: [], unit: "USD" },
  { id: "usage", label: "Usage", group: "Revenue", type: "REVENUE", description: "Usage revenue: units consumed × price per unit.", keywords: ["metered", "consumption", "api calls", "tokens", "revenue"], config: { revenueType: "usage" }, params: [usd("price", "Price per unit", 0.01)], unit: "USD" },
  { id: "revenue-recognition", label: "Revenue Recognition", group: "Revenue", type: "REVENUE_RECOGNITION", description: "Defers cash billed in advance and recognizes it when earned (credits used or expired).", keywords: ["deferred", "prepaid", "credits", "recognition", "accounting", "breakage"], config: { revenueType: "topup" }, params: [], unit: "USD" },
  { id: "breakage", label: "Breakage", group: "Revenue", type: "FLOW", description: "Value of expired credits: credits expired × price per credit. Wire into Revenue Recognition's “to recognize”.", keywords: ["expired", "credits", "breakage", "unused"], params: [usd("multiplier", "Price per credit", 0.01, "USD/credits")], unit: "USD" },
  { id: "topup", label: "Top-up", group: "Revenue", type: "REVENUE", description: "Top-up revenue: credits purchased × price per credit.", keywords: ["credits", "wallet", "purchase", "revenue"], config: { revenueType: "topup" }, params: [usd("price", "Price per credit", 0.1)], unit: "USD" },

  // Costs
  { id: "fixed-cost", label: "Fixed Cost", group: "Costs", type: "COST", description: "A monthly cost that does not depend on volume (rent, salaries).", keywords: ["rent", "salary", "payroll", "overhead", "opex", "expense"], config: { costType: "fixed", costClass: "opex", category: "other" }, params: [usd("amount", "Monthly cost", 10000)], unit: "USD" },
  { id: "variable-cost", label: "Variable Cost", group: "Costs", type: "COST", description: "Cost per customer or unit (COGS, hosting per user).", keywords: ["cogs", "per customer", "unit cost", "hosting", "ai cost"], config: { costType: "variable", costClass: "cogs", category: "infrastructure" }, params: [usd("unitCost", "Cost per unit", 8, "USD/customers")], unit: "USD" },
  { id: "percentage-cost", label: "Percentage Cost", group: "Costs", type: "COST", description: "A percentage of an amount, e.g. payment fees on revenue.", keywords: ["payment fee", "stripe", "commission", "processing", "percent"], config: { costType: "percentage", costClass: "cogs", category: "payment" }, params: [pct("rate", "Percentage", 0.029)], unit: "USD" },
  { id: "usage-cost", label: "Usage Cost", group: "Costs", type: "COST", description: "Cost of usage, e.g. AI tokens: credits burned × cost per credit.", keywords: ["ai", "tokens", "inference", "compute", "usage", "cogs"], config: { costType: "variable", costClass: "cogs", category: "ai" }, params: [usd("unitCost", "Cost per credit", 0.004, "USD/credits")], unit: "USD" },
  { id: "standing-charge", label: "Standing Charge", group: "Costs", type: "COST", description: "A fixed charge per active account per month, whatever the usage (hosting, storage).", keywords: ["hosting", "storage", "per account", "baseline", "standing"], config: { costType: "variable", costClass: "cogs", category: "infrastructure" }, params: [usd("unitCost", "Charge per account", 1.5, "USD/customers")], unit: "USD" },
  { id: "capacity-pool", label: "Capacity Pool", group: "Costs", type: "COST", description: "Whole units of a resource that each serve a fixed load, e.g. one guardian per 120 accounts.", keywords: ["guardian", "staff", "support", "capacity", "headcount", "servers"], config: { costType: "capacity", costClass: "cogs", category: "payroll" }, params: [{ slot: "capacityPerUnit", name: "Accounts per unit", value: 120, unit: "customers", min: 0 }, usd("unitCost", "Cost per unit per month", 6000)], unit: "USD" },
  { id: "step-cost", label: "Step Cost", group: "Costs", type: "COST", description: "Cost that jumps at volume thresholds (infrastructure tiers).", keywords: ["tier", "infrastructure", "servers", "threshold"], config: { costType: "step", costClass: "cogs", category: "infrastructure", tiers: [{ upTo: 1000, cost: 500 }, { upTo: 5000, cost: 1000 }, { cost: 2000 }] }, params: [], unit: "USD" },

  // Resources
  { id: "cash", label: "Cash", group: "Resources", type: "CASH", description: "Bank balance. Connect revenue to inflow and costs to outflow.", keywords: ["bank", "balance", "runway", "money", "funding"], params: [usd("initial", "Starting cash", 500000)], unit: "USD" },
  { id: "pool", label: "Pool", group: "Resources", type: "POOL", description: "A stock of anything, e.g. a credit wallet.", keywords: ["stock", "wallet", "credits", "balance", "inventory"], params: [{ slot: "initial", name: "Initial balance", value: 0, unit: "credits" }] },
  { id: "flow", label: "Flow", group: "Resources", type: "FLOW", description: "A per-period quantity, optionally scaled.", keywords: ["stream", "transfer", "quantity"], params: [{ slot: "multiplier", name: "Multiplier", value: 1, unit: "number" }] },
  { id: "burn", label: "Burn", group: "Resources", type: "FLOW", description: "Consumes a resource: connect it to a pool's outflow.", keywords: ["consume", "credit burn", "usage", "spend"], params: [{ slot: "multiplier", name: "Burn per unit", value: 1, unit: "credits" }], unit: "credits" },
  { id: "credit-wallet", label: "Credit Wallet", group: "Resources", type: "CREDIT_WALLET", description: "Credits customers hold: grants and top-ups in, usage out, unused credits expire (breakage).", keywords: ["credits", "wallet", "balance", "breakage", "expiry", "rationing"], params: [{ slot: "initial", name: "Starting credits", value: 0, unit: "credits", min: 0 }, pct("expiryRate", "Expiry of unused credits", 0.05)], unit: "credits" },
  { id: "credit-grant", label: "Credit Grant", group: "Resources", type: "FLOW", description: "Credits included with a plan: customers × credits per customer. Wire into a Credit Wallet's grants.", keywords: ["credits", "allowance", "included", "plan", "grant"], params: [{ slot: "multiplier", name: "Credits per customer", value: 1000, unit: "credits" }], unit: "credits" },
  { id: "credit-burn", label: "Credit Burn", group: "Resources", type: "FLOW", description: "Credits customers want to use: customers × credits used per customer. Wire into a Credit Wallet's demand.", keywords: ["credits", "usage", "consumption", "burn", "tokens"], params: [{ slot: "multiplier", name: "Credits used per customer", value: 800, unit: "credits" }], unit: "credits" },
  { id: "capacity", label: "Capacity", group: "Resources", type: "CAPACITY", description: "Maximum throughput; flags when demand exceeds it.", keywords: ["limit", "servers", "support", "throughput", "max"], params: [{ slot: "capacity", name: "Capacity", value: 1000, unit: "customers", min: 0 }] },

  // Logic
  { id: "condition", label: "Condition", group: "Logic", type: "CONDITION", description: "IF a value crosses a threshold THEN one value ELSE another.", keywords: ["if", "rule", "threshold", "when"], config: { operator: ">" }, params: [{ slot: "threshold", name: "Threshold", value: 0, unit: "number" }, { slot: "then", name: "Then", value: 1, unit: "number" }, { slot: "else", name: "Else", value: 0, unit: "number" }] },
  { id: "trigger", label: "Trigger", group: "Logic", type: "CONDITION", description: "Record an event on the timeline when a condition becomes true.", keywords: ["event", "alert", "when", "notify"], config: { operator: ">", eventLabel: "Trigger fired" }, params: [{ slot: "threshold", name: "Threshold", value: 0, unit: "number" }] },
  { id: "formula", label: "Formula", group: "Logic", type: "FORMULA", description: "Custom expression, e.g. revenue / customers. Variables become inputs.", keywords: ["expression", "calculate", "custom", "math", "equation"], config: { expression: "a * b" }, params: [] },
];

export function findPreset(id: string): NodePreset | undefined {
  return NODE_PRESETS.find((p) => p.id === id);
}

/** Case-insensitive search over label, keywords and description; label matches rank first. */
export function searchPresets(query: string): NodePreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...NODE_PRESETS];
  const score = (p: NodePreset) => {
    const label = p.label.toLowerCase();
    if (label === q) return 0;
    if (label.startsWith(q)) return 1;
    if (label.includes(q)) return 2;
    if (p.keywords.some((k) => k.includes(q))) return 3;
    if (p.description.toLowerCase().includes(q)) return 4;
    return -1;
  };
  return NODE_PRESETS.map((p) => [p, score(p)] as const)
    .filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);
}

