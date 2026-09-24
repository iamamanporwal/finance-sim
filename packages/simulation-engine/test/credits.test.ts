import { validateModel, type ModelInput } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import { simulate } from "../src";

const settings = { startDate: "2027-01", timeStep: "monthly" as const, horizon: 3, seed: 1, currency: "USD" as const };

function walletModel(demand: number, expiry = 0.1): ModelInput {
  return {
    id: "wallet",
    name: "Wallet",
    settings,
    parameters: [
      { id: "p_init", name: "Starting credits", value: 100, unit: "credits" },
      { id: "p_grant", name: "Grant", value: 1000, unit: "credits" },
      { id: "p_demand", name: "Demand", value: demand, unit: "credits" },
      { id: "p_expiry", name: "Expiry", value: expiry, unit: "percent" },
    ],
    nodes: [
      { id: "grant", type: "INPUT", label: "Grant", parameters: { value: "p_grant" } },
      { id: "demand", type: "INPUT", label: "Demand", parameters: { value: "p_demand" } },
      { id: "wallet", type: "CREDIT_WALLET", label: "Wallet", parameters: { initial: "p_init", expiryRate: "p_expiry" } },
    ],
    connections: [
      { id: "c1", source: "grant", target: "wallet", targetPort: "grants" },
      { id: "c2", source: "demand", target: "wallet", targetPort: "demand" },
    ],
  };
}

describe("Credit Wallet", () => {
  it("burns, expires (breakage) and carries credits forward", () => {
    const r = simulate(walletModel(800));
    const w = r.timeline.map((p) => p.nodes.wallet!);
    // P1: available 1,100 → burn 800 → 300 unused → 30 expire → 270 left.
    expect(w[0]).toMatchObject({ opening: 100, inflow: 1000, burned: 800, rationed: 0, expired: 30, out: 270 });
    expect(w[0]!.burnDepth).toBeCloseTo(800 / 1100, 12);
    expect(w[0]!.breakageRate).toBeCloseTo(30 / 1100, 12);
    // P2: available 1,270 → burn 800 → 470 unused → 47 expire → 423 left.
    expect(w[1]).toMatchObject({ opening: 270, burned: 800, expired: 47, out: 423 });
    expect(r.timeline[1]!.metrics).toMatchObject({ creditBalance: 423, creditsBurned: 800, creditsExpired: 47 });
    expect(r.timeline[1]!.metrics.breakageRate).toBeCloseTo(47 / 1270, 12);
  });

  it("rations demand the wallet cannot cover", () => {
    const r = simulate(walletModel(1500, 0));
    const w = r.timeline[0]!.nodes.wallet!;
    expect(w).toMatchObject({ burned: 1100, rationed: 400, expired: 0, out: 0 });
    expect(r.timeline[0]!.metrics.rationingRate).toBeCloseTo(400 / 1500, 12);
  });

  it("expires credits above the maximum balance", () => {
    const m = walletModel(0, 0) as ModelInput & { parameters: NonNullable<ModelInput["parameters"]> };
    m.parameters.push({ id: "p_max", name: "Cap", value: 500, unit: "credits" });
    m.nodes[2] = { ...m.nodes[2]!, parameters: { initial: "p_init", maximum: "p_max" } };
    const w = simulate(m).timeline[0]!.nodes.wallet!;
    expect(w).toMatchObject({ out: 500, expired: 600 });
  });

  it("models without credits report credit metrics as empty", () => {
    const r = simulate({ ...walletModel(0), nodes: walletModel(0).nodes.slice(0, 1), connections: [] });
    expect(r.timeline[0]!.metrics.creditBalance).toBeNull();
    expect(r.timeline[0]!.metrics.burnDepth).toBeNull();
  });
});

describe("Revenue Recognition", () => {
  const model = (rate: number): ModelInput => ({
    id: "rr",
    name: "Deferred revenue",
    settings,
    parameters: [
      { id: "p_billed", name: "Billed", value: 1000, unit: "USD" },
      { id: "p_use", name: "Earned", value: 600, unit: "USD" },
      { id: "p_rate", name: "Rate", value: rate, unit: "percent" },
      { id: "p_cash", name: "Cash", value: 0, unit: "USD" },
    ],
    nodes: [
      { id: "billed", type: "INPUT", label: "Top-up billings", parameters: { value: "p_billed" } },
      { id: "earned", type: "INPUT", label: "Credits used (USD)", parameters: { value: "p_use" } },
      { id: "rr", type: "REVENUE_RECOGNITION", label: "Recognition", parameters: { recognitionRate: "p_rate" }, config: { revenueType: "topup" } },
      { id: "cash", type: "CASH", label: "Cash", parameters: { initial: "p_cash" } },
    ],
    connections: [
      { id: "c1", source: "billed", target: "rr", targetPort: "billed" },
      { id: "c2", source: "earned", target: "rr", targetPort: "recognize" },
      { id: "c3", source: "billed", target: "cash", targetPort: "inflow" },
    ],
  });

  it("separates cash received from revenue recognized", () => {
    const r = simulate(model(0));
    const [p1, p2] = r.timeline;
    expect(p1!.nodes.rr).toMatchObject({ billed: 1000, out: 600, deferred: 400 });
    expect(p2!.nodes.rr).toMatchObject({ opening: 400, out: 600, deferred: 800 });
    // Cash grows by the full billing; revenue only by what was earned.
    expect(p2!.cash.closing).toBe(2000);
    expect(p2!.revenue).toMatchObject({ topups: 600, total: 600 });
    expect(p2!.metrics.deferredRevenue).toBe(800);
  });

  it("recognizes a share of the opening balance and never more than was billed", () => {
    const p2 = simulate(model(0.5)).timeline[1]!.nodes.rr!;
    // 600 earned + 50% of the 400 opening balance.
    expect(p2).toMatchObject({ out: 800, deferred: 600 });
    const capped = simulate({ ...model(0), parameters: model(0).parameters!.map((p) => (p.id === "p_use" ? { ...p, value: 5000 } : p)) });
    expect(capped.timeline[0]!.nodes.rr).toMatchObject({ out: 1000, deferred: 0 });
  });
});

describe("capacity cost and custom metrics", () => {
  const model: ModelInput = {
    id: "guardians",
    name: "Guardians",
    settings,
    parameters: [
      { id: "p_accounts", name: "Accounts", value: 250, unit: "customers" },
      { id: "p_per", name: "Accounts per guardian", value: 120, unit: "customers" },
      { id: "p_salary", name: "Guardian cost", value: 5000, unit: "USD" },
    ],
    nodes: [
      { id: "accounts", type: "INPUT", label: "Accounts", parameters: { value: "p_accounts" } },
      { id: "guardians", type: "COST", label: "Guardians", parameters: { capacityPerUnit: "p_per", unitCost: "p_salary" }, config: { costType: "capacity", costClass: "cogs", category: "payroll" } },
    ],
    connections: [{ id: "c1", source: "accounts", target: "guardians", targetPort: "volume" }],
    customMetrics: [
      {
        key: "apg",
        label: "Accounts per guardian",
        expression: "accounts / guardians",
        unit: "number",
        inputs: { accounts: { nodeId: "accounts" }, guardians: { nodeId: "guardians", port: "units" } },
      },
      { key: "costPerAccount", label: "Guardian cost per account", expression: "cogs / apg / guardians", unit: "currency", inputs: { cogs: { metric: "cogs" }, apg: { metric: "apg" }, guardians: { nodeId: "guardians", port: "units" } } },
    ],
    guardrails: [{ id: "g_apg", label: "APG > 50", metric: "apg", operator: ">", threshold: 50 }],
  };

  it("buys whole units of capacity", () => {
    const p = simulate(model).timeline[0]!;
    expect(p.nodes.guardians).toMatchObject({ units: 3, out: 15000 });
    expect(p.nodes.guardians!.utilization).toBeCloseTo(250 / 360, 12);
    expect(p.costs.cogs).toBe(15000);
  });

  it("evaluates custom metrics per period, in order, and guardrails can use them", () => {
    const r = simulate(model);
    expect(r.timeline[0]!.metrics.apg).toBeCloseTo(250 / 3, 12);
    expect(r.timeline[0]!.metrics.costPerAccount).toBeCloseTo(15000 / (250 / 3) / 3, 9);
    expect(r.guardrails).toEqual([{ guardrailId: "g_apg", violations: [], passed: true }]);
  });

  it("custom metrics are empty when the formula cannot be evaluated", () => {
    const zero: ModelInput = { ...model, parameters: model.parameters!.map((p) => (p.id === "p_accounts" ? { ...p, value: 0 } : p)) };
    expect(simulate(zero).timeline[0]!.metrics.apg).toBeNull();
  });

  it("validates custom metric definitions", () => {
    const bad = (customMetrics: ModelInput["customMetrics"]) => validateModel({ ...model, guardrails: [], customMetrics }).issues.filter((i) => i.severity === "error").map((i) => i.message);
    expect(bad([{ key: "mrr", label: "Clash", expression: "1", inputs: {} }])).toEqual(['Custom metric "Clash": the key "mrr" is already used by a built-in metric.']);
    expect(bad([{ key: "x", label: "X", expression: "a + b", inputs: { a: { metric: "revenue" } } }])).toEqual(['Custom metric "X": "b" is used in the formula but not linked to a metric or node.']);
    expect(bad([{ key: "x", label: "X", expression: "a", inputs: { a: { nodeId: "guardians", port: "nope" } } }])).toEqual(['Custom metric "X": Guardians has no output "nope".']);
    expect(bad([{ key: "x", label: "X", expression: "a", inputs: { a: { metric: "y" } } }, { key: "y", label: "Y", expression: "1", inputs: {} }])[0]).toMatch(/unknown metric "y"/);
    const warn = validateModel({ ...model, customMetrics: [{ ...model.customMetrics![0]!, status: "needs_confirmation" }], guardrails: [] }).issues;
    expect(warn.map((i) => i.code)).toContain("unconfirmed-metric");
  });
});

describe("NRR and plan moves", () => {
  // Basic ($10, 10% churn, 5% upgrade to Pro, +20 new/mo) and Pro ($50, no churn).
  const model: ModelInput = {
    id: "nrr",
    name: "NRR",
    settings,
    parameters: [
      { id: "p_b0", name: "Basic start", value: 100, unit: "customers" },
      { id: "p_new", name: "New", value: 20, unit: "customers" },
      { id: "p_churn", name: "Churn", value: 0.1, unit: "percent" },
      { id: "p_up", name: "Upgrade", value: 0.05, unit: "percent" },
      { id: "p_pb", name: "Basic price", value: 10, unit: "USD" },
      { id: "p_pp", name: "Pro price", value: 50, unit: "USD" },
    ],
    nodes: [
      { id: "new", type: "INPUT", label: "New", parameters: { value: "p_new" } },
      { id: "basic", type: "CUSTOMERS", label: "Basic", parameters: { initial: "p_b0", churnRate: "p_churn" } },
      { id: "pro", type: "CUSTOMERS", label: "Pro" },
      { id: "up", type: "CONVERSION", label: "Upgrade", parameters: { rate: "p_up" } },
      { id: "bp", type: "PRICE", label: "Basic price", parameters: { price: "p_pb" } },
      { id: "pp", type: "PRICE", label: "Pro price", parameters: { price: "p_pp" } },
      { id: "rb", type: "REVENUE", label: "Basic revenue", config: { revenueType: "subscription" } },
      { id: "rp", type: "REVENUE", label: "Pro revenue", config: { revenueType: "subscription" } },
    ],
    connections: [
      { id: "c1", source: "new", target: "basic", targetPort: "new" },
      { id: "c2", source: "basic", sourcePort: "opening", target: "up", targetPort: "input" },
      { id: "c3", source: "up", target: "basic", targetPort: "moved" },
      { id: "c4", source: "up", target: "pro", targetPort: "movedIn" },
      { id: "c5", source: "basic", target: "rb", targetPort: "quantity" },
      { id: "c6", source: "bp", target: "rb", targetPort: "price" },
      { id: "c7", source: "pro", target: "rp", targetPort: "quantity" },
      { id: "c8", source: "pp", target: "rp", targetPort: "price" },
    ],
  };

  it("moves customers between plans without counting them as new", () => {
    const [p1, p2] = simulate(model).timeline;
    expect(p1!.nodes.basic).toMatchObject({ opening: 100, churned: 10, moved: 5, out: 105 });
    expect(p1!.nodes.pro).toMatchObject({ movedIn: 5, new: 0, out: 5 });
    expect(p1!.customers).toMatchObject({ new: 20, churned: 10, closing: 110 });
    expect(p2!.metrics.mrr).toBeCloseTo(109.25 * 10 + 10.25 * 50, 9);
  });

  it("computes NRR from existing customers' MRR", () => {
    const [p1, p2] = simulate(model).timeline;
    expect(p1!.metrics.nrr).toBeNull();
    expect(p2!.metrics.newMrr).toBeCloseTo(200, 9);
    // Existing customers: Basic 89.25 × $10 + Pro 10.25 × $50 = $1,405 vs $1,300 last month.
    expect(p2!.metrics.nrr).toBeCloseTo(1405 / 1300, 12);
    expect(p2!.metrics.nrrAnnual).toBeNull();
  });
});

describe("chained wallets", () => {
  it("counts only finally-unmet demand as rationed when plan credits overflow into top-ups", () => {
    const m: ModelInput = {
      id: "chain",
      name: "Chain",
      settings,
      parameters: [
        { id: "p_grant", name: "Allowance", value: 1000, unit: "credits" },
        { id: "p_demand", name: "Demand", value: 1500, unit: "credits" },
        { id: "p_topup", name: "Top-ups", value: 300, unit: "credits" },
        { id: "p_reset", name: "Reset", value: 1, unit: "percent" },
      ],
      nodes: [
        { id: "grant", type: "INPUT", label: "Allowance", parameters: { value: "p_grant" } },
        { id: "demand", type: "INPUT", label: "Demand", parameters: { value: "p_demand" } },
        { id: "topups", type: "INPUT", label: "Top-ups", parameters: { value: "p_topup" } },
        { id: "plan", type: "CREDIT_WALLET", label: "Plan credits", parameters: { expiryRate: "p_reset" } },
        { id: "wallet", type: "CREDIT_WALLET", label: "Top-up wallet" },
      ],
      connections: [
        { id: "c1", source: "grant", target: "plan", targetPort: "grants" },
        { id: "c2", source: "demand", target: "plan", targetPort: "demand" },
        { id: "c3", source: "plan", sourcePort: "rationed", target: "wallet", targetPort: "demand" },
        { id: "c4", source: "topups", target: "wallet", targetPort: "purchases" },
      ],
    };
    const p = simulate(m).timeline[0]!;
    expect(p.nodes.plan).toMatchObject({ burned: 1000, rationed: 500 });
    expect(p.nodes.wallet).toMatchObject({ burned: 300, rationed: 200 });
    // 200 of the 1,500 credits wanted could not be served.
    expect(p.metrics.rationingRate).toBeCloseTo(200 / 1500, 12);
  });
});
