import { collectIdentifiers, parseFormula } from "@fin/formula-engine";
import type { ModelNode, NodeCategory, NodeType } from "./types";

/**
 * A slot is a named input of a node. Its value comes from (in priority order):
 * 1. connections into the slot (summed when `multiple`),
 * 2. the node's parameter bound to the slot,
 * 3. the slot default.
 */
export interface SlotSpec {
  name: string;
  label: string;
  description: string;
  /** Kind of value expected; drives UI input and validation. */
  kind: "rate" | "money" | "count" | "value" | "period";
  required: boolean;
  /** May be wired from another node's output. */
  connectable: boolean;
  /** May be set directly through a parameter. */
  parameter: boolean;
  /** Several connections allowed; their values are summed. */
  multiple?: boolean;
  default?: number;
  /** Allowed range for the canonical value (rates are fractions: 1 = 100%). */
  range?: { min?: number; max?: number; message: string };
}

export interface OutputSpec {
  name: string;
  label: string;
  description: string;
  /**
   * Lagged outputs are known at the start of the period (e.g. a stock's opening
   * balance). Edges from them do not create same-period dependencies, which lets
   * models express legitimate feedback loops.
   */
  lagged?: boolean;
}

export type FinancialRole = "revenue" | "cost" | "cash" | "customers" | "acquisition";

export interface NodeTypeSpec {
  type: NodeType;
  label: string;
  category: NodeCategory;
  description: string;
  /** How the node's main value is computed, in plain language. Shown in the UI ("never hide the logic"). */
  formula: string;
  role?: FinancialRole;
  /** Static slots; some node types add dynamic slots (see slotsFor). */
  slots: SlotSpec[];
  outputs: OutputSpec[];
  /** Stocks carry state from one period to the next. */
  stateful?: boolean;
}

const rate = (name: string, label: string, description: string, extra: Partial<SlotSpec> = {}): SlotSpec => ({
  name,
  label,
  description,
  kind: "rate",
  required: true,
  connectable: true,
  parameter: true,
  ...extra,
});

const value = (name: string, label: string, description: string, extra: Partial<SlotSpec> = {}): SlotSpec => ({
  name,
  label,
  description,
  kind: "value",
  required: true,
  connectable: true,
  parameter: true,
  ...extra,
});

const OUT: OutputSpec = { name: "out", label: "Value", description: "The node's result for the period" };
const PROBABILITY = { min: 0, max: 1, message: "must be between 0% and 100%" };
const NON_NEGATIVE = { min: 0, message: "must not be negative" };

const stockOutputs = (unit: string): OutputSpec[] => [
  { name: "out", label: `Closing ${unit}`, description: `${unit} at the end of the period` },
  { name: "opening", label: `Opening ${unit}`, description: `${unit} at the start of the period`, lagged: true },
  { name: "inflow", label: "Inflow", description: "Total added during the period" },
  { name: "outflow", label: "Outflow", description: "Total removed during the period" },
];

export const NODE_CATALOG: Readonly<Record<NodeType, NodeTypeSpec>> = {
  INPUT: {
    type: "INPUT",
    label: "Input",
    category: "inputs",
    description: "A value you control, such as monthly signups or a growth rate.",
    formula: "value",
    slots: [value("value", "Value", "The assumption's value", { connectable: false })],
    outputs: [OUT],
  },
  GROWTH: {
    type: "GROWTH",
    label: "Growth",
    category: "inputs",
    description: "Grows a base value over time.",
    formula: "compound: base × (1 + rate)^(t − start) · linear: base × (1 + rate × (t − start)) · absolute: base + rate × (t − start)",
    slots: [
      value("base", "Base value", "The value in the first period"),
      rate("rate", "Growth rate", "Growth per period (or absolute increase per period for absolute growth)"),
    ],
    outputs: [OUT],
    stateful: true,
  },
  ACQUISITION: {
    type: "ACQUISITION",
    label: "Acquisition",
    category: "customers",
    description: "New customers from paid marketing (budget ÷ CAC) plus organic.",
    formula: "budget ÷ CAC + organic",
    role: "acquisition",
    slots: [
      { ...value("budget", "Marketing budget", "Paid acquisition spend per period", { required: false, default: 0, range: NON_NEGATIVE }), kind: "money" },
      { ...value("cac", "CAC", "Cost to acquire one paid customer", { required: false, default: 0, range: NON_NEGATIVE }), kind: "money" },
      { ...value("organic", "Organic", "Customers acquired without spend", { required: false, default: 0, range: NON_NEGATIVE, multiple: true }), kind: "count" },
    ],
    outputs: [
      { name: "out", label: "New customers", description: "Paid + organic" },
      { name: "paid", label: "Paid", description: "Budget ÷ CAC" },
      { name: "organic", label: "Organic", description: "Organic customers" },
      { name: "spend", label: "Spend", description: "Marketing spend (counted as a marketing cost)" },
    ],
  },
  CONVERSION: {
    type: "CONVERSION",
    label: "Conversion",
    category: "customers",
    description: "Converts a flow of prospects into customers.",
    formula: "input × rate",
    slots: [
      { ...value("input", "Input", "Prospects, visitors or signups", { parameter: true, multiple: true }), kind: "count" },
      rate("rate", "Conversion rate", "Share that converts", { range: PROBABILITY }),
    ],
    outputs: [OUT],
  },
  CUSTOMERS: {
    type: "CUSTOMERS",
    label: "Customers",
    category: "customers",
    description: "A stock of customers: grows with new customers, shrinks with churn.",
    formula: "closing = opening + new − opening × churn rate − moved out",
    role: "customers",
    stateful: true,
    slots: [
      { ...value("initial", "Starting customers", "Customers before the first period", { required: false, connectable: false, default: 0, range: NON_NEGATIVE }), kind: "count" },
      { ...value("new", "New customers", "Customers added each period", { required: false, default: 0, multiple: true }), kind: "count" },
      rate("churnRate", "Churn rate", "Share of opening customers lost each period", { required: false, default: 0, range: PROBABILITY }),
      {
        ...value("moved", "Moved out", "Customers moving to another plan (upgrades/downgrades)", { required: false, default: 0, multiple: true, parameter: false }),
        kind: "count",
      },
    ],
    outputs: [
      { name: "out", label: "Customers", description: "Customers at the end of the period" },
      { name: "opening", label: "Opening customers", description: "Customers at the start of the period", lagged: true },
      { name: "new", label: "New customers", description: "Customers added this period" },
      { name: "churned", label: "Churned customers", description: "Customers lost this period" },
      { name: "moved", label: "Moved out", description: "Customers moved to another plan this period" },
    ],
  },
  CHURN: {
    type: "CHURN",
    label: "Churn",
    category: "customers",
    description: "The share of customers who leave each period. Connect it to a Customers node.",
    formula: "per period: rate · annual: 1 − (1 − rate)^(1 / periods per year)",
    slots: [rate("rate", "Churn rate", "Share of customers lost", { range: PROBABILITY })],
    outputs: [OUT],
  },
  SPLIT: {
    type: "SPLIT",
    label: "Split",
    category: "customers",
    description: "Splits a flow across branches (e.g. plans). Weights must total 100%.",
    formula: "branch = input × branch weight",
    slots: [{ ...value("input", "Input", "The flow to split", { multiple: true, parameter: false }), kind: "count" }],
    outputs: [], // dynamic: one per branch
  },
  PRICE: {
    type: "PRICE",
    label: "Price",
    category: "revenue",
    description: "Price per customer or unit, after discount.",
    formula: "price × (1 − discount)",
    slots: [
      { ...value("price", "Price", "List price per period", { range: NON_NEGATIVE }), kind: "money" },
      rate("discount", "Discount", "Average discount", { required: false, default: 0, range: PROBABILITY }),
    ],
    outputs: [OUT],
  },
  REVENUE: {
    type: "REVENUE",
    label: "Revenue",
    category: "revenue",
    description: "Revenue from a quantity (customers, units, credits) at a price.",
    formula: "quantity × price",
    role: "revenue",
    slots: [
      { ...value("quantity", "Quantity", "Customers, units or credits sold", { multiple: true }), kind: "count" },
      { ...value("price", "Price", "Price per unit", { range: NON_NEGATIVE }), kind: "money" },
    ],
    outputs: [OUT],
  },
  COST: {
    type: "COST",
    label: "Cost",
    category: "costs",
    description: "A fixed, variable, percentage or step cost.",
    formula: "fixed: amount × (1 + growth)^(t − 1) · variable: volume × unit cost · percentage: base × rate · step: tier cost for volume",
    role: "cost",
    slots: [], // dynamic: depends on costType
    outputs: [OUT],
  },
  POOL: {
    type: "POOL",
    label: "Pool",
    category: "resources",
    description: "A stock of anything (credits, capacity) that accumulates inflows and outflows.",
    formula: "closing = clamp(opening + inflow − outflow, minimum, maximum)",
    stateful: true,
    slots: [
      value("initial", "Initial balance", "Balance before the first period", { required: false, connectable: false, default: 0 }),
      value("inflow", "Inflow", "Added each period", { required: false, default: 0, multiple: true }),
      value("outflow", "Outflow", "Removed each period", { required: false, default: 0, multiple: true }),
      value("minimum", "Minimum", "Floor for the balance", { required: false, connectable: false }),
      value("maximum", "Maximum", "Cap for the balance", { required: false, connectable: false }),
    ],
    outputs: [
      ...stockOutputs("balance"),
      { name: "overflow", label: "Overflow", description: "Amount above the maximum that was discarded" },
      { name: "shortfall", label: "Shortfall", description: "Outflow that could not be covered because of the minimum" },
    ],
  },
  CASH: {
    type: "CASH",
    label: "Cash",
    category: "resources",
    description: "The bank balance. Connect revenue to inflow and costs to outflow.",
    formula: "closing = opening + inflow − outflow",
    role: "cash",
    stateful: true,
    slots: [
      { ...value("initial", "Starting cash", "Cash before the first period", { required: false, connectable: false, default: 0 }), kind: "money" },
      { ...value("inflow", "Inflow", "Cash received (revenue, funding)", { required: false, default: 0, multiple: true }), kind: "money" },
      { ...value("outflow", "Outflow", "Cash spent (costs)", { required: false, default: 0, multiple: true }), kind: "money" },
    ],
    outputs: stockOutputs("cash"),
  },
  FLOW: {
    type: "FLOW",
    label: "Flow",
    category: "resources",
    description: "A per-period quantity, optionally scaled by a multiplier.",
    formula: "amount × multiplier",
    slots: [
      value("amount", "Amount", "Quantity per period", { multiple: true }),
      value("multiplier", "Multiplier", "Scaling factor", { required: false, default: 1 }),
    ],
    outputs: [OUT],
  },
  CAPACITY: {
    type: "CAPACITY",
    label: "Capacity",
    category: "resources",
    description: "Maximum throughput. Flags when demand exceeds capacity.",
    formula: "served = min(demand, capacity) · excess = max(0, demand − capacity)",
    slots: [
      value("demand", "Demand", "Load placed on the resource", { multiple: true }),
      value("capacity", "Capacity", "Maximum that can be handled", { range: NON_NEGATIVE }),
    ],
    outputs: [
      { name: "out", label: "Served", description: "min(demand, capacity)" },
      { name: "excess", label: "Excess demand", description: "Demand above capacity" },
      { name: "utilization", label: "Utilization", description: "demand ÷ capacity" },
    ],
  },
  CONDITION: {
    type: "CONDITION",
    label: "Condition",
    category: "logic",
    description: "IF value (operator) threshold THEN one value ELSE another.",
    formula: "if(value <op> threshold, then, else)",
    slots: [
      value("value", "Value", "The value to test"),
      value("threshold", "Threshold", "The value to compare against"),
      value("then", "Then", "Output when the condition is true", { required: false, default: 1 }),
      value("else", "Else", "Output when the condition is false", { required: false, default: 0 }),
    ],
    outputs: [OUT, { name: "active", label: "Active", description: "1 when the condition is true, otherwise 0" }],
  },
  FORMULA: {
    type: "FORMULA",
    label: "Formula",
    category: "logic",
    description: "A custom expression. Each variable becomes an input you can wire or set.",
    formula: "custom expression",
    slots: [], // dynamic: one per variable in the expression
    outputs: [OUT],
  },
};

/** Names every formula can use without wiring. */
export const FORMULA_RESERVED_VARIABLES = new Set(["period"]);

const COST_SLOTS: Record<string, SlotSpec[]> = {
  fixed: [
    { ...value("amount", "Amount", "Cost per period", { range: NON_NEGATIVE }), kind: "money" },
    rate("growth", "Growth", "Cost growth per period", { required: false, default: 0 }),
  ],
  variable: [
    { ...value("volume", "Volume", "Units driving the cost (customers, usage)", { multiple: true }), kind: "count" },
    { ...value("unitCost", "Cost per unit", "Cost for each unit", { range: NON_NEGATIVE }), kind: "money" },
  ],
  percentage: [
    { ...value("base", "Base", "Amount the percentage applies to (usually revenue)", { multiple: true }), kind: "money" },
    rate("rate", "Percentage", "Share of the base", { range: PROBABILITY }),
  ],
  step: [{ ...value("volume", "Volume", "Units that select the cost tier", { multiple: true }), kind: "count" }],
};

/** Returns the formula's variables, or an empty list when it does not parse (validators report that separately). */
export function formulaVariables(expression: string): string[] {
  try {
    return [...collectIdentifiers(parseFormula(expression))].filter((v) => !FORMULA_RESERVED_VARIABLES.has(v)).sort();
  } catch {
    return [];
  }
}

/** Resolves the complete slot list for a node, including dynamic slots. */
export function slotsFor(node: ModelNode): SlotSpec[] {
  switch (node.type) {
    case "COST":
      return COST_SLOTS[node.config.costType] ?? [];
    case "SPLIT":
      return [
        ...NODE_CATALOG.SPLIT.slots,
        ...node.config.branches.map((b) =>
          rate(`weight.${b.key}`, `${b.label} share`, `Share of the input routed to ${b.label}`, {
            connectable: false,
            range: PROBABILITY,
          }),
        ),
      ];
    case "FORMULA":
      return formulaVariables(node.config.expression).map((v) =>
        value(v, v, `Variable "${v}" used in the formula`),
      );
    default:
      return NODE_CATALOG[node.type].slots;
  }
}

/** Resolves the complete output list for a node, including dynamic outputs. */
export function outputsFor(node: ModelNode): OutputSpec[] {
  if (node.type === "SPLIT") {
    return node.config.branches.map((b) => ({ name: b.key, label: b.label, description: `Share routed to ${b.label}` }));
  }
  return NODE_CATALOG[node.type].outputs;
}

export function findSlot(node: ModelNode, name: string): SlotSpec | undefined {
  return slotsFor(node).find((s) => s.name === name);
}

export function findOutput(node: ModelNode, name: string): OutputSpec | undefined {
  return outputsFor(node).find((o) => o.name === name);
}
