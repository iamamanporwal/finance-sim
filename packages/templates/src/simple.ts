import type { ModelInput } from "@fin/model-schema";
import { cost, GraphBuilder, SETTINGS } from "./builder";

const guardrails = (margin: number): NonNullable<ModelInput["guardrails"]> => [
  { id: "g_margin", label: `Gross margin > ${Math.round(margin * 100)}%`, metric: "grossMargin", operator: ">", threshold: margin },
  { id: "g_runway", label: "Runway > 6 months", metric: "runwayMonths", operator: ">", threshold: 6, severity: "critical" },
  { id: "g_cash", label: "Cash > $0", metric: "cash", operator: ">", threshold: 0, severity: "critical" },
];

/** Top of funnel shared by most templates: visitors → growth → conversion → customers. */
function funnel(b: GraphBuilder, o: { visitors: number; growth: number; conversion: number; churn: number; startCustomers?: number; label?: string }) {
  b.p("p_visitors", "Visitors per month", o.visitors, "users");
  b.p("p_growth", "Monthly visitor growth", o.growth, "percent");
  b.p("p_conversion", "Conversion rate", o.conversion, "percent");
  b.p("p_churn", "Monthly churn", o.churn, "percent");
  b.p("p_start_customers", "Current customers", o.startCustomers ?? 0, "customers");
  b.node("visitors", "INPUT", o.label ?? "Visitors", [0, 0], { params: { value: "p_visitors" }, unit: "users" });
  b.node("growth", "GROWTH", "Visitor growth", [1, 0], { params: { rate: "p_growth" }, unit: "users" });
  b.node("conversion", "CONVERSION", "Conversion", [2, 0], { params: { rate: "p_conversion" }, unit: "customers" });
  b.node("customers", "CUSTOMERS", "Customers", [3, 0], { params: { initial: "p_start_customers", churnRate: "p_churn" }, unit: "customers" });
  b.link("visitors", "growth", "base");
  b.link("growth", "conversion", "input");
  b.link("conversion", "customers", "new");
}

/** Payroll, software and cash, wired so every revenue and cost moves cash. */
function operations(b: GraphBuilder, o: { payroll: number; software: number; cash: number; revenues: string[]; costs: string[]; inflows?: string[] }) {
  b.p("p_payroll", "Payroll per month", o.payroll, "USD");
  b.p("p_payroll_growth", "Monthly payroll growth", 0.02, "percent");
  b.p("p_software", "Software & tools per month", o.software, "USD");
  b.p("p_cash", "Starting cash", o.cash, "USD");
  b.node("payroll", "COST", "Payroll", [5, 3], { params: { amount: "p_payroll", growth: "p_payroll_growth" }, config: cost("fixed", "opex", "payroll"), unit: "USD" });
  b.node("software", "COST", "Software", [5, 4], { params: { amount: "p_software" }, config: cost("fixed", "opex", "software"), unit: "USD" });
  b.node("cash", "CASH", "Cash", [7, 2], { params: { initial: "p_cash" }, unit: "USD" });
  for (const r of [...o.revenues, ...(o.inflows ?? [])]) b.link(r, "cash", "inflow");
  for (const c of [...o.costs, "payroll", "software"]) b.link(c, "cash", "outflow");
}

export function saasTemplate(): ModelInput {
  const b = new GraphBuilder();
  funnel(b, { visitors: 5000, growth: 0.08, conversion: 0.03, churn: 0.03 });
  b.p("p_price", "Price per month", 49, "USD/customers");
  b.p("p_hosting", "Hosting per customer", 4, "USD/customers");
  b.p("p_fees", "Payment processing fee", 0.029, "percent");
  b.node("price", "PRICE", "Price", [3, 1], { params: { price: "p_price" }, unit: "USD" });
  b.node("revenue", "REVENUE", "Subscription revenue", [4, 0], { config: { revenueType: "subscription" }, unit: "USD" });
  b.node("hosting", "COST", "Hosting", [4, 2], { params: { unitCost: "p_hosting" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD" });
  b.node("fees", "COST", "Payment fees", [5, 1], { params: { rate: "p_fees" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.link("customers", "revenue", "quantity");
  b.link("price", "revenue", "price");
  b.link("customers", "hosting", "volume");
  b.link("revenue", "fees", "base");
  operations(b, { payroll: 40000, software: 3000, cash: 600000, revenues: ["revenue"], costs: ["hosting", "fees"] });
  return b.build({ id: "tpl-saas", name: "SaaS subscription", description: "Visitors convert into monthly subscribers who churn over time. Costs: hosting per customer, payment fees, payroll and software.", settings: SETTINGS(24), guardrails: guardrails(0.7), stage: "seed", metadata: { templateId: "saas", businessType: "saas", revenueModel: "subscription" } });
}

export function aiSaasTemplate(): ModelInput {
  const b = new GraphBuilder();
  funnel(b, { visitors: 3000, growth: 0.1, conversion: 0.05, churn: 0.05, label: "Signups" });
  b.p("p_price", "Price per month", 39, "USD/customers");
  b.p("p_ai", "AI inference per customer", 9, "USD/customers");
  b.p("p_hosting", "Hosting per customer", 2, "USD/customers");
  b.p("p_fees", "Payment processing fee", 0.029, "percent");
  b.node("price", "PRICE", "Price", [3, 1], { params: { price: "p_price" }, unit: "USD" });
  b.node("revenue", "REVENUE", "Subscription revenue", [4, 0], { config: { revenueType: "subscription" }, unit: "USD" });
  b.node("ai", "COST", "AI inference", [4, 2], { params: { unitCost: "p_ai" }, config: cost("variable", "cogs", "ai"), unit: "USD" });
  b.node("hosting", "COST", "Hosting", [4, 3], { params: { unitCost: "p_hosting" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD" });
  b.node("fees", "COST", "Payment fees", [5, 1], { params: { rate: "p_fees" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.link("customers", "revenue", "quantity");
  b.link("price", "revenue", "price");
  b.link("customers", "ai", "volume");
  b.link("customers", "hosting", "volume");
  b.link("revenue", "fees", "base");
  operations(b, { payroll: 35000, software: 2500, cash: 750000, revenues: ["revenue"], costs: ["ai", "hosting", "fees"] });
  return b.build({ id: "tpl-ai-saas", name: "AI SaaS", description: "Subscription AI product where every customer drives inference cost. Watch gross margin as usage grows.", settings: SETTINGS(24), guardrails: guardrails(0.55), stage: "pre-seed", metadata: { templateId: "ai-saas", businessType: "ai-saas", revenueModel: "subscription" } });
}

export function usageSaasTemplate(): ModelInput {
  const b = new GraphBuilder();
  funnel(b, { visitors: 4000, growth: 0.07, conversion: 0.04, churn: 0.03 });
  b.p("p_platform", "Platform fee per month", 19, "USD/customers");
  b.p("p_units", "Usage units per customer", 5000, "units");
  b.p("p_unit_growth", "Monthly usage growth per customer", 0.02, "percent");
  b.p("p_unit_price", "Price per usage unit", 0.004, "USD/units");
  b.p("p_unit_cost", "Cost per usage unit", 0.0012, "USD/units");
  b.p("p_fees", "Payment processing fee", 0.029, "percent");
  b.node("platform", "REVENUE", "Platform fees", [4, 0], { params: { price: "p_platform" }, config: { revenueType: "subscription" }, unit: "USD" });
  b.node("perCustomer", "GROWTH", "Usage per customer", [3, 2], { params: { base: "p_units", rate: "p_unit_growth" }, unit: "units" });
  b.node("usage", "FORMULA", "Usage units", [4, 1], { config: { expression: "customers * perCustomer" }, unit: "units" });
  b.node("usageRevenue", "REVENUE", "Usage revenue", [5, 0], { params: { price: "p_unit_price" }, config: { revenueType: "usage" }, unit: "USD" });
  b.node("usageCost", "COST", "Usage infrastructure", [5, 2], { params: { unitCost: "p_unit_cost" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD" });
  b.node("fees", "COST", "Payment fees", [6, 1], { params: { rate: "p_fees" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.link("customers", "platform", "quantity");
  b.link("customers", "usage", "customers");
  b.link("perCustomer", "usage", "perCustomer");
  b.link("usage", "usageRevenue", "quantity");
  b.link("usage", "usageCost", "volume");
  b.link("platform", "fees", "base");
  b.link("usageRevenue", "fees", "base");
  operations(b, { payroll: 45000, software: 3000, cash: 900000, revenues: ["platform", "usageRevenue"], costs: ["usageCost", "fees"] });
  return b.build({ id: "tpl-usage-saas", name: "Usage-based SaaS", description: "A small platform fee plus pay-as-you-go usage. Revenue grows with both customers and usage per customer.", settings: SETTINGS(24), guardrails: guardrails(0.6), stage: "seed", metadata: { templateId: "usage-saas", businessType: "usage-saas", revenueModel: "usage" } });
}

/**
 * Subscription + credits: plans include a monthly credit allowance; demand
 * beyond it overflows into a top-up wallet. Top-up cash is deferred and
 * recognized as revenue when the credits are used or expire.
 */
export function creditSaasTemplate(): ModelInput {
  const b = new GraphBuilder();
  funnel(b, { visitors: 3000, growth: 0.09, conversion: 0.05, churn: 0.04, label: "Signups" });
  b.p("p_price", "Plan price per month", 29, "USD/customers");
  b.p("p_allowance", "Credits included per customer", 2000, "credits");
  b.p("p_demand", "Credits wanted per customer", 2100, "credits");
  b.p("p_reset", "Unused allowance that lapses", 1, "percent");
  b.p("p_topup_buy", "Top-up credits bought per credit short", 1.1, "number");
  b.p("p_topup_expiry", "Monthly expiry of top-up credits", 0.03, "percent");
  b.p("p_credit_price", "Top-up price per credit", 0.012, "USD/credits");
  b.p("p_credit_cost", "AI cost per credit used", 0.004, "USD/credits");
  b.p("p_fees", "Payment processing fee", 0.029, "percent");
  b.node("revenue", "REVENUE", "Subscription revenue", [4, 0], { params: { price: "p_price" }, config: { revenueType: "subscription" }, unit: "USD" });
  addCreditEconomy(b, { customers: ["customers"], grants: [["customers", "p_allowance"]], demand: [["customers", "p_demand"]], col: 4, row: 2 });
  b.node("fees", "COST", "Payment fees", [7, 0], { params: { rate: "p_fees" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.link("customers", "revenue", "quantity");
  b.link("revenue", "fees", "base");
  b.link("topupBillings", "fees", "base");
  operations(b, { payroll: 40000, software: 3000, cash: 800000, revenues: ["revenue"], inflows: ["topupBillings"], costs: ["aiCost", "fees"] });
  return b.build({
    id: "tpl-credit-saas",
    name: "AI SaaS + subscription + credits",
    description: "Plans include monthly credits; heavy users buy top-ups. Cash from top-ups is deferred and recognized when credits are used or expire (breakage).",
    settings: SETTINGS(24),
    guardrails: [...guardrails(0.55), { id: "g_breakage", label: "Breakage < 8%", metric: "breakageRate", operator: "<", threshold: 0.08 }, { id: "g_rationing", label: "Rationing < 15%", metric: "rationingRate", operator: "<", threshold: 0.15 }],
    stage: "seed",
    metadata: { templateId: "credit-saas", businessType: "credit-saas", revenueModel: "subscription+credits" },
  });
}

/**
 * Reusable credit economy: Credit Grant → Credit Wallet → Credit Burn, overflow
 * into a top-up wallet, top-up billing into Cash and Revenue Recognition, and AI
 * usage cost on every credit burned. Expects p_reset, p_topup_buy,
 * p_topup_expiry, p_credit_price and p_credit_cost to exist.
 */
export function addCreditEconomy(
  b: GraphBuilder,
  o: { customers: string[]; grants: [string, string][]; demand: [string, string][]; col: number; row: number; overageParam?: string },
) {
  const { col, row } = o;
  o.grants.forEach(([source, param], i) => {
    b.node(`grant_${source}`, "FLOW", `Credit grant · ${label(source)}`, [col, row + i * 0.6], { params: { multiplier: param }, unit: "credits" });
    b.link(source, `grant_${source}`, "amount");
  });
  o.demand.forEach(([source, param], i) => {
    b.node(`burn_${source}`, "FLOW", `Credit burn · ${label(source)}`, [col, row + (o.grants.length + i) * 0.6], { params: { multiplier: param }, unit: "credits" });
    b.link(source, `burn_${source}`, "amount");
  });
  b.node("planCredits", "CREDIT_WALLET", "Plan credits", [col + 1, row], { params: { expiryRate: "p_reset" }, unit: "credits", description: "Monthly allowance included in plans. Unused allowance lapses (breakage); demand beyond it flows to top-ups." });
  for (const [s] of o.grants) b.link(`grant_${s}`, "planCredits", "grants");
  for (const [s] of o.demand) b.link(`burn_${s}`, "planCredits", "demand");
  b.node("topupPurchases", "FLOW", "Top-up purchases", [col + 1, row + 1.2], { params: { multiplier: "p_topup_buy" }, unit: "credits" });
  b.link("planCredits", "topupPurchases", "amount", "rationed");
  b.node("topupWallet", "CREDIT_WALLET", "Top-up wallet", [col + 2, row + 1.2], { params: { expiryRate: "p_topup_expiry" }, unit: "credits", description: "Purchased credits. They roll over but slowly expire." });
  b.link("planCredits", "topupWallet", "demand", "rationed");
  b.link("topupPurchases", "topupWallet", "purchases");
  if (o.overageParam) {
    // Averages hide heavy users: some accounts need more than their allowance even when the average does not.
    b.node("heavyOverage", "FLOW", "Heavy-user overage", [col + 1, row + 2.2], { params: { multiplier: o.overageParam }, unit: "credits", description: "Credits heavy users need beyond their plan, per paid account." });
    for (const c of o.customers) b.link(c, "heavyOverage", "amount");
    b.link("heavyOverage", "topupWallet", "demand");
    b.link("heavyOverage", "topupPurchases", "amount");
  }
  b.node("topupBillings", "FLOW", "Top-up billings", [col + 2, row + 2.2], { params: { multiplier: "p_credit_price" }, unit: "USD", description: "Cash collected for top-ups (not yet revenue)." });
  b.link("topupPurchases", "topupBillings", "amount");
  b.node("earnedCredits", "FLOW", "Top-up credits earned", [col + 3, row + 1.2], { params: { multiplier: "p_credit_price" }, unit: "USD", description: "(Credits burned + expired) × price per credit." });
  b.link("topupWallet", "earnedCredits", "amount", "burned");
  b.link("topupWallet", "earnedCredits", "amount", "expired");
  b.node("recognition", "REVENUE_RECOGNITION", "Top-up revenue", [col + 3, row + 2.2], { config: { revenueType: "topup" }, unit: "USD" });
  b.link("topupBillings", "recognition", "billed");
  b.link("earnedCredits", "recognition", "recognize");
  b.node("aiCost", "COST", "AI tokens", [col + 2, row], { params: { unitCost: "p_credit_cost" }, config: cost("variable", "cogs", "ai"), unit: "USD", description: "Every credit used, from the plan allowance or top-ups, costs AI inference." });
  b.link("planCredits", "aiCost", "volume", "burned");
  b.link("topupWallet", "aiCost", "volume", "burned");
}

const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export function marketplaceTemplate(): ModelInput {
  const b = new GraphBuilder();
  funnel(b, { visitors: 20000, growth: 0.06, conversion: 0.02, churn: 0.06, label: "Visitors" });
  b.p("p_orders", "Orders per buyer per month", 1.4, "orders");
  b.p("p_aov", "Average order value", 60, "USD");
  b.p("p_take", "Take rate", 0.12, "percent");
  b.p("p_processing", "Payment processing (on GMV)", 0.029, "percent");
  b.p("p_support", "Support cost per order", 0.8, "USD/orders");
  b.node("orders", "FLOW", "Orders", [4, 1], { params: { multiplier: "p_orders" }, unit: "orders" });
  b.node("gmv", "FLOW", "GMV", [5, 1], { params: { multiplier: "p_aov" }, unit: "USD", description: "Gross merchandise value: orders × average order value." });
  b.node("commission", "REVENUE", "Commission revenue", [6, 0], { params: { price: "p_take" }, config: { revenueType: "other" }, unit: "USD", description: "GMV × take rate." });
  b.node("processing", "COST", "Payment processing", [6, 2], { params: { rate: "p_processing" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.node("support", "COST", "Order support", [5, 2], { params: { unitCost: "p_support" }, config: cost("variable", "cogs", "other"), unit: "USD" });
  b.link("customers", "orders", "amount");
  b.link("orders", "gmv", "amount");
  b.link("gmv", "commission", "quantity");
  b.link("gmv", "processing", "base");
  b.link("orders", "support", "volume");
  operations(b, { payroll: 50000, software: 4000, cash: 1200000, revenues: ["commission"], costs: ["processing", "support"] });
  return b.build({ id: "tpl-marketplace", name: "Marketplace", description: "Buyers place orders; the marketplace keeps a take rate on GMV and pays processing on the full order value.", settings: SETTINGS(24), guardrails: guardrails(0.5), stage: "seed", metadata: { templateId: "marketplace", businessType: "marketplace", revenueModel: "take rate" } });
}

export function apiTemplate(): ModelInput {
  const b = new GraphBuilder();
  funnel(b, { visitors: 1500, growth: 0.08, conversion: 0.06, churn: 0.025, label: "Developer signups" });
  b.p("p_base", "Base plan per month", 29, "USD/customers");
  b.p("p_calls", "API calls per customer (thousands)", 250, "units");
  b.p("p_call_growth", "Monthly call growth per customer", 0.03, "percent");
  b.p("p_call_price", "Price per 1,000 calls", 0.5, "USD/units");
  b.p("p_call_cost", "Infrastructure per 1,000 calls", 0.12, "USD/units");
  b.p("p_fees", "Payment processing fee", 0.029, "percent");
  b.node("base", "REVENUE", "Base plans", [4, 0], { params: { price: "p_base" }, config: { revenueType: "subscription" }, unit: "USD" });
  b.node("perCustomer", "GROWTH", "Calls per customer (K)", [3, 2], { params: { base: "p_calls", rate: "p_call_growth" }, unit: "units" });
  b.node("calls", "FORMULA", "API calls (K)", [4, 1], { config: { expression: "customers * perCustomer" }, unit: "units" });
  b.node("callRevenue", "REVENUE", "API usage revenue", [5, 0], { params: { price: "p_call_price" }, config: { revenueType: "usage" }, unit: "USD" });
  b.node("callCost", "COST", "API infrastructure", [5, 2], { params: { unitCost: "p_call_cost" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD" });
  b.node("fees", "COST", "Payment fees", [6, 1], { params: { rate: "p_fees" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.link("customers", "base", "quantity");
  b.link("customers", "calls", "customers");
  b.link("perCustomer", "calls", "perCustomer");
  b.link("calls", "callRevenue", "quantity");
  b.link("calls", "callCost", "volume");
  b.link("base", "fees", "base");
  b.link("callRevenue", "fees", "base");
  operations(b, { payroll: 38000, software: 2500, cash: 700000, revenues: ["base", "callRevenue"], costs: ["callCost", "fees"] });
  return b.build({ id: "tpl-api", name: "API business", description: "Developers pay a base plan plus metered API calls; infrastructure cost scales with calls.", settings: SETTINGS(24), guardrails: guardrails(0.6), stage: "pre-seed", metadata: { templateId: "api", businessType: "api", revenueModel: "usage" } });
}
