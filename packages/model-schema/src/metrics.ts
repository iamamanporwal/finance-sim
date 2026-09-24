import type { MetricDefinition } from "./types";

/**
 * Metrics produced for every timeline period (TimelinePoint.metrics).
 * Guardrails reference these keys.
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, description: "Total revenue recognized in the period." },
  { key: "mrr", label: "MRR", unit: "currency", higherIsBetter: true, description: "Monthly recurring revenue: subscription revenue normalized to one month." },
  { key: "arr", label: "ARR", unit: "currency", higherIsBetter: true, description: "Annual recurring revenue: MRR × 12." },
  { key: "cogs", label: "COGS", unit: "currency", higherIsBetter: false, description: "Cost of goods sold: the direct costs of delivering your product." },
  { key: "grossProfit", label: "Gross profit", unit: "currency", higherIsBetter: true, description: "Revenue minus COGS." },
  { key: "grossMargin", label: "Gross margin", unit: "percent", higherIsBetter: true, description: "The percentage of revenue left after the direct costs of delivering your product." },
  { key: "opex", label: "Operating expenses", unit: "currency", higherIsBetter: false, description: "Costs of running the company that are not COGS (salaries, rent, marketing)." },
  { key: "totalCosts", label: "Total costs", unit: "currency", higherIsBetter: false, description: "COGS plus operating expenses." },
  { key: "operatingProfit", label: "Operating profit", unit: "currency", higherIsBetter: true, description: "Revenue minus all costs." },
  { key: "customers", label: "Customers", unit: "count", higherIsBetter: true, description: "Customers at the end of the period." },
  { key: "newCustomers", label: "New customers", unit: "count", higherIsBetter: true, description: "Customers added in the period." },
  { key: "churnedCustomers", label: "Churned customers", unit: "count", higherIsBetter: false, description: "Customers lost in the period." },
  { key: "churnRate", label: "Churn rate", unit: "percent", higherIsBetter: false, description: "Churned customers ÷ opening customers." },
  { key: "arpu", label: "ARPU", unit: "currency", higherIsBetter: true, description: "Average revenue per customer in the period." },
  { key: "cash", label: "Cash", unit: "currency", higherIsBetter: true, description: "Cash at the end of the period." },
  { key: "netCashFlow", label: "Net cash flow", unit: "currency", higherIsBetter: true, description: "Cash inflow minus cash outflow in the period." },
  { key: "burn", label: "Burn", unit: "currency", higherIsBetter: false, description: "Net cash spent in the period (0 when cash flow is positive)." },
  { key: "cac", label: "CAC", unit: "currency", higherIsBetter: false, description: "Customer acquisition cost: marketing spend ÷ new customers in the period." },
  { key: "cacPaybackMonths", label: "CAC payback", unit: "months", higherIsBetter: false, description: "Months of gross profit from one customer needed to earn back what it cost to acquire them." },
  { key: "runwayMonths", label: "Runway", unit: "months", higherIsBetter: true, description: "Months until cash runs out at the current burn. Empty when not burning." },
];

export const METRIC_KEYS = new Set(METRIC_DEFINITIONS.map((m) => m.key));

export function getMetricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_DEFINITIONS.find((m) => m.key === key);
}
