import type { ModelInput } from "@fin/model-schema";
import { cost, GraphBuilder, SETTINGS } from "./builder";
import { addCreditEconomy } from "./simple";

/**
 * HERE: signups → activation → conversion → plan mix → paid plans, a free
 * "Signal" tier, a credit economy (grants, wallet, burn, top-ups, breakage,
 * revenue recognition) and HERE's cost structure (AI tokens, guardians,
 * hosting, storage, payment fees).
 *
 * Built only from generic nodes; the engine knows nothing about HERE. Every
 * value is an example to replace. APG and WSCB are custom metrics: APG uses an
 * assumed definition and WSCB is a placeholder, both flagged for confirmation.
 */
export function hereTemplate(): ModelInput {
  const b = new GraphBuilder();
  const plans = [
    { id: "prime", label: "Prime", share: 0.78, price: 29, churn: 0.045, grant: 2000, burn: 1850 },
    { id: "studio", label: "Studio", share: 0.17, price: 79, churn: 0.03, grant: 6000, burn: 5600 },
    { id: "world", label: "World", share: 0.04, price: 249, churn: 0.02, grant: 25000, burn: 23500 },
    { id: "dedicated", label: "Dedicated", share: 0.01, price: 1500, churn: 0.01, grant: 150000, burn: 140000 },
  ];

  // ── Acquisition: Signups → Activation → Conversion → Plan split ──
  b.p("p_signups", "Signups per month", 6000, "users");
  b.p("p_signup_growth", "Monthly signup growth", 0.08, "percent");
  b.p("p_activation", "Activation rate", 0.45, "percent");
  b.p("p_conversion", "Paid conversion of activated users", 0.15, "percent");
  b.p("p_signal_start", "Signal (free) users today", 4000, "users");
  b.p("p_signal_churn", "Monthly Signal churn", 0.1, "percent");
  b.node("signups", "INPUT", "Signups", [0, 0], { params: { value: "p_signups" }, unit: "users" });
  b.node("signupGrowth", "GROWTH", "Signup growth", [1, 0], { params: { rate: "p_signup_growth" }, unit: "users" });
  b.node("activation", "CONVERSION", "Activation", [2, 0], { params: { rate: "p_activation" }, unit: "users" });
  b.node("conversion", "CONVERSION", "Conversion", [3, 0], { params: { rate: "p_conversion" }, unit: "customers" });
  b.node("signal", "POOL", "Signal (free)", [3, 1.2], { params: { initial: "p_signal_start" }, unit: "users", description: "Activated users on the free Signal tier. Converting users leave it for a paid plan." });
  b.node("signalChurn", "FLOW", "Signal churn", [2, 1.8], { params: { multiplier: "p_signal_churn" }, unit: "users" });
  b.link("signups", "signupGrowth", "base");
  b.link("signupGrowth", "activation", "input");
  b.link("activation", "conversion", "input");
  b.link("activation", "signal", "inflow");
  b.link("conversion", "signal", "outflow");
  b.link("signal", "signalChurn", "amount", "opening");
  b.link("signalChurn", "signal", "outflow");

  b.node("planSplit", "SPLIT", "Plan mix", [4, 0], {
    config: { branches: plans.map((p) => ({ key: p.id, label: p.label })) },
    params: Object.fromEntries(plans.map((p) => [`weight.${p.id}`, b.p(`p_share_${p.id}`, `${p.label} share of new customers`, p.share, "percent")])),
  });
  b.link("conversion", "planSplit", "input");

  // ── Paid plans ──
  plans.forEach((p, i) => {
    b.p(`p_price_${p.id}`, `${p.label} price per month`, p.price, "USD/customers");
    b.p(`p_churn_${p.id}`, `${p.label} monthly churn`, p.churn, "percent");
    b.p(`p_grant_${p.id}`, `${p.label} credits per month`, p.grant, "credits");
    b.p(`p_burn_${p.id}`, `${p.label} credits used per customer`, p.burn, "credits");
    b.node(p.id, "CUSTOMERS", p.label, [5, i * 1.1], { params: { churnRate: `p_churn_${p.id}` }, unit: "customers" });
    b.node(`rev_${p.id}`, "REVENUE", `${p.label} revenue`, [6, i * 1.1], { params: { price: `p_price_${p.id}` }, config: { revenueType: "subscription" }, unit: "USD" });
    b.link("planSplit", p.id, "new", p.id);
    b.link(p.id, `rev_${p.id}`, "quantity");
  });
  // Upgrades: Prime → Studio → World.
  b.p("p_up_prime", "Prime → Studio upgrades per month", 0.015, "percent");
  b.p("p_up_studio", "Studio → World upgrades per month", 0.01, "percent");
  for (const [from, to, param] of [["prime", "studio", "p_up_prime"], ["studio", "world", "p_up_studio"]] as const) {
    b.node(`up_${from}`, "CONVERSION", `Upgrade ${from === "prime" ? "Prime → Studio" : "Studio → World"}`, [4, from === "prime" ? 1.6 : 2.7], { params: { rate: param }, unit: "customers" });
    b.link(from, `up_${from}`, "input", "opening");
    b.link(`up_${from}`, from, "moved");
    b.link(`up_${from}`, to, "movedIn");
  }

  // ── Credit economy ──
  b.p("p_reset", "Unused plan credits that lapse each month", 1, "percent");
  b.p("p_topup_buy", "Top-up credits bought per credit short", 1.1, "number");
  b.p("p_topup_expiry", "Monthly expiry of top-up credits", 0.03, "percent");
  b.p("p_credit_price", "Top-up price per credit", 0.01, "USD/credits");
  b.p("p_credit_cost", "AI token cost per credit", 0.0025, "USD/credits");
  b.p("p_overage", "Heavy-user overage credits per paid account", 250, "credits");
  addCreditEconomy(b, {
    customers: plans.map((p) => p.id),
    grants: plans.map((p) => [p.id, `p_grant_${p.id}`]),
    demand: plans.map((p) => [p.id, `p_burn_${p.id}`]),
    col: 7,
    row: 0,
    overageParam: "p_overage",
  });

  // ── Costs ──
  b.p("p_accounts_per_guardian", "Accounts per guardian", 120, "customers");
  b.p("p_guardian_cost", "Cost per guardian per month", 900, "USD");
  b.p("p_hosting", "Hosting per paid account", 1.2, "USD/customers");
  b.p("p_signal_hosting", "Hosting per Signal user", 0.3, "USD/users");
  b.p("p_storage", "Storage per paid account", 0.6, "USD/customers");
  b.p("p_fees", "Payment processing fee", 0.029, "percent");
  b.p("p_payroll", "Payroll per month", 85000, "USD");
  b.p("p_payroll_growth", "Monthly payroll growth", 0.02, "percent");
  b.p("p_marketing", "Marketing per month", 15000, "USD");
  b.p("p_cash", "Starting cash", 2500000, "USD");
  b.node("guardians", "COST", "Guardians", [8, 4.2], { params: { capacityPerUnit: "p_accounts_per_guardian", unitCost: "p_guardian_cost" }, config: cost("capacity", "cogs", "payroll"), unit: "USD", description: "Guardian instances; each serves a fixed number of paid accounts (capacity pool)." });
  b.node("hosting", "COST", "Hosting", [8, 5.2], { params: { unitCost: "p_hosting" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD", description: "Standing charge per paid account." });
  b.node("signalHosting", "COST", "Signal hosting", [4, 3.8], { params: { unitCost: "p_signal_hosting" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD", description: "Standing charge per free user." });
  b.node("storage", "COST", "Storage", [8, 6.2], { params: { unitCost: "p_storage" }, config: cost("variable", "cogs", "infrastructure"), unit: "USD" });
  b.node("fees", "COST", "Payment fees", [9, 5.2], { params: { rate: "p_fees" }, config: cost("percentage", "cogs", "payment"), unit: "USD" });
  b.node("payroll", "COST", "Payroll", [9, 6.4], { params: { amount: "p_payroll", growth: "p_payroll_growth" }, config: cost("fixed", "opex", "payroll"), unit: "USD" });
  b.node("marketing", "COST", "Marketing", [9, 7.4], { params: { amount: "p_marketing" }, config: cost("fixed", "opex", "marketing"), unit: "USD" });
  b.node("cash", "CASH", "Cash", [11, 3], { params: { initial: "p_cash" }, unit: "USD" });
  for (const p of plans) {
    b.link(p.id, "guardians", "volume");
    b.link(p.id, "hosting", "volume");
    b.link(p.id, "storage", "volume");
    b.link(`rev_${p.id}`, "fees", "base");
    b.link(`rev_${p.id}`, "cash", "inflow");
  }
  b.link("signal", "signalHosting", "volume");
  b.link("topupBillings", "fees", "base");
  b.link("topupBillings", "cash", "inflow");
  for (const c of ["aiCost", "guardians", "hosting", "signalHosting", "storage", "fees", "payroll", "marketing"]) b.link(c, "cash", "outflow");

  return b.build({
    id: "tpl-here",
    name: "HERE",
    description:
      "Signups → activation → conversion → plan mix (Prime, Studio, World, Dedicated) plus the free Signal tier. Plans include monthly credits; top-ups are deferred and recognized as credits are used or expire. Costs: AI tokens, guardians, hosting, storage, payment fees, payroll and marketing.",
    settings: SETTINGS(36),
    stage: "seed",
    metadata: { templateId: "here", businessType: "credit-saas", revenueModel: "subscription+credits" },
    customMetrics: [
      {
        key: "apg",
        label: "APG",
        description: "Accounts per guardian: paid accounts ÷ guardians employed. Assumed definition — confirm or edit it.",
        unit: "number",
        expression: "accounts / guardians",
        inputs: { accounts: { metric: "customers" }, guardians: { nodeId: "guardians", port: "units" } },
        higherIsBetter: true,
        status: "needs_confirmation",
      },
      {
        key: "wscb",
        label: "WSCB",
        description: "Placeholder: credits held per paid account. The PRD does not define WSCB — replace this formula with the real definition.",
        unit: "number",
        expression: "credits / accounts",
        inputs: { credits: { metric: "creditBalance" }, accounts: { metric: "customers" } },
        status: "needs_confirmation",
      },
    ],
    guardrails: [
      { id: "g_margin", label: "Gross margin > 55%", metric: "grossMargin", operator: ">", threshold: 0.55 },
      { id: "g_runway", label: "Runway > 6 months", metric: "runwayMonths", operator: ">", threshold: 6, severity: "critical" },
      { id: "g_breakage", label: "Breakage < 8%", metric: "breakageRate", operator: "<", threshold: 0.08 },
      { id: "g_apg", label: "APG > 50", metric: "apg", operator: ">", threshold: 50 },
      { id: "g_rationing", label: "Rationing < 15%", metric: "rationingRate", operator: "<", threshold: 0.15 },
      { id: "g_cash", label: "Cash > $0", metric: "cash", operator: ">", threshold: 0, severity: "critical" },
    ],
  });
}
