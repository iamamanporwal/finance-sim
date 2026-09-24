/**
 * Deterministic graph builder: turns reviewed assumptions into a model using the
 * same node presets and editing operations as the canvas. The AI never writes
 * graph structure directly, so every generated model is structurally sound; the
 * result is still fully validated before it is shown.
 */
import { type Model, type Parameter } from "@fin/model-schema";
import * as ops from "@/lib/model-ops";
import { findPreset } from "@/lib/presets";
import { assumptionDef, type AssumptionKey, type BusinessSpec, type ExtractedAssumption } from "./business-spec";

export interface BuildInput {
  name: string;
  summary?: string;
  businessType?: BusinessSpec["businessType"];
  assumptions: ExtractedAssumption[];
  startDate?: string;
}

type Values = Partial<Record<AssumptionKey, ExtractedAssumption>>;

const COL = 280;

export function buildModelFromAssumptions(input: BuildInput): Model {
  const v: Values = Object.fromEntries(input.assumptions.map((a) => [a.key, a]));
  const touched = new Set<string>();
  let m = ops.createBlankModel(input.name);
  m = { ...m, description: input.summary ?? "", metadata: { ...m.metadata, templateId: `ai:${input.businessType ?? "other"}` } };
  if (input.startDate) m = ops.updateSettings(m, { startDate: input.startDate });

  const add = (presetId: string, label: string, col: number, row: number, values: Partial<Record<string, AssumptionKey>> = {}, unit?: string): string => {
    const preset = findPreset(presetId)!;
    const r = ops.addNode(m, { ...preset, label }, { x: col * COL, y: row * 170 });
    m = r.model;
    const node = m.nodes.find((n) => n.id === r.nodeId)!;
    m = { ...m, nodes: m.nodes.map((n) => (n.id === r.nodeId ? { ...n, label, unit: unit ?? n.unit, metadata: { source: "ai" as const } } : n)) };
    for (const [slot, key] of Object.entries(values)) {
      const a = key ? v[key] : undefined;
      if (!a) continue;
      let pid = node.parameters[slot];
      if (!pid) {
        m = ops.bindNewParameter(m, r.nodeId, slot);
        pid = m.nodes.find((n) => n.id === r.nodeId)!.parameters[slot]!;
      }
      m = ops.updateParameter(m, pid, parameterFields(a));
      touched.add(pid);
    }
    return r.nodeId;
  };
  const connect = (source: string, target: string, targetPort: string, sourcePort = "out") => {
    m = ops.connect(m, { source, sourcePort, target, targetPort });
  };

  // ── Acquisition ──
  const newCustomerSources: string[] = [];
  if (v.visitors && v.conversion) {
    const visitors = add("input", "Visitors", 0, 0, { value: "visitors" }, "users");
    let top = visitors;
    if (v.growth) {
      top = add("growth", "Visitor growth", 1, 0, { rate: "growth" }, "users");
      connect(visitors, top, "base");
    }
    const conversion = add("conversion", "Conversion", 2, 0, { rate: "conversion" }, "customers");
    connect(top, conversion, "input");
    newCustomerSources.push(conversion);
  }
  if (v.marketingBudget && v.cac) {
    const acq = add("acquisition", "Paid marketing", 2, 1, { budget: "marketingBudget", cac: "cac" }, "customers");
    // Organic comes from the funnel above; keep the preset's organic at 0.
    const organicPid = m.nodes.find((n) => n.id === acq)!.parameters.organic;
    if (organicPid) m = ops.updateParameter(m, organicPid, { value: 0 });
    newCustomerSources.push(acq);
  }

  // ── Customers ──
  const customers = add("customers", "Customers", 3, 0, { initial: "startingCustomers" }, "customers");
  for (const s of newCustomerSources) connect(s, customers, "new");
  if (v.churn) {
    const churn = add("churn", "Churn", 2, 2, { rate: "churn" });
    connect(churn, customers, "churnRate");
  }

  // ── Revenue ──
  const revenues: string[] = [];
  if (v.price) {
    const price = add("price", "Price", 3, 1, { price: "price" }, "USD");
    const sub = add("subscription", "Subscription revenue", 4, 0, {}, "USD");
    connect(customers, sub, "quantity");
    connect(price, sub, "price");
    revenues.push(sub);
  }
  if (v.usagePerCustomer && v.usagePrice) {
    const usage = add("flow", "Usage units", 4, 1, { multiplier: "usagePerCustomer" }, "units");
    connect(customers, usage, "amount");
    const rev = add("usage", "Usage revenue", 5, 1, { price: "usagePrice" }, "USD");
    connect(usage, rev, "quantity");
    revenues.push(rev);
  }

  // ── Costs ──
  const costs: string[] = [];
  if (v.cogsPerCustomer) {
    const cogs = add("variable-cost", "Cost to serve", 4, 2, { unitCost: "cogsPerCustomer" }, "USD");
    connect(customers, cogs, "volume");
    costs.push(cogs);
  }
  if (v.paymentFeeRate && revenues.length) {
    const fees = add("percentage-cost", "Payment fees", 5, 2, { rate: "paymentFeeRate" }, "USD");
    for (const r of revenues) connect(r, fees, "base");
    costs.push(fees);
  }
  if (v.fixedCosts) costs.push(add("fixed-cost", "Fixed costs", 5, 3, { amount: "fixedCosts" }, "USD"));
  if (v.payroll) {
    const payroll = add("fixed-cost", "Payroll", 5, 4, { amount: "payroll" }, "USD");
    const node = m.nodes.find((n) => n.id === payroll)!;
    m = ops.updateNode(m, payroll, { config: { ...(node.config as object), category: "payroll" } });
    costs.push(payroll);
  }

  // ── Cash ── (only with a known starting balance: never invented)
  if (v.startingCash) {
    const cash = add("cash", "Cash", 6, 1, { initial: "startingCash" }, "USD");
    for (const r of revenues) connect(r, cash, "inflow");
    for (const c of costs) connect(c, cash, "outflow");
    const acq = m.nodes.find((n) => n.type === "ACQUISITION");
    if (acq) connect(acq.id, cash, "outflow", "spend");
  }

  // Preset defaults nobody specified (e.g. 0 starting customers, 0% discount) are labelled as template values, not user input.
  return {
    ...m,
    parameters: m.parameters.map((p) => (touched.has(p.id) ? p : { ...p, source: "template" as const, description: p.description ?? "Default value — not from your description." })),
  };
}

function parameterFields(a: ExtractedAssumption): Partial<Omit<Parameter, "id">> {
  const def = assumptionDef(a.key)!;
  return {
    name: def.label,
    value: a.value,
    unit: def.unit,
    source: a.source === "user" ? "user" : "ai",
    confidence: a.confidence,
    // AI-inferred values need the user's review before they are trusted.
    status: a.source === "ai" ? "pending" : "accepted",
    description: a.evidence ? (a.source === "user" ? `From your description: “${a.evidence}”` : `AI reasoning: ${a.evidence}`) : undefined,
  };
}
