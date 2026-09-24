import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

/** Stable, URL/JSON-safe identifier. */
export const IdSchema = z
  .string()
  .min(1, "ID must not be empty")
  .max(64, "ID must be at most 64 characters")
  .regex(/^[A-Za-z0-9_-]+$/, "ID may only contain letters, digits, '_' and '-'");

const finiteNumber = z.number().refine(Number.isFinite, "Must be a finite number");

export const NODE_TYPES = [
  "INPUT",
  "GROWTH",
  "ACQUISITION",
  "CONVERSION",
  "CUSTOMERS",
  "CHURN",
  "SPLIT",
  "PRICE",
  "REVENUE",
  "COST",
  "POOL",
  "CASH",
  "FLOW",
  "CAPACITY",
  "CONDITION",
  "FORMULA",
] as const;
export const NodeTypeSchema = z.enum(NODE_TYPES);

export const NODE_CATEGORIES = ["inputs", "customers", "revenue", "costs", "resources", "logic"] as const;
export const NodeCategorySchema = z.enum(NODE_CATEGORIES);

export const TIME_STEPS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export const TimeStepSchema = z.enum(TIME_STEPS);

export const CURRENCIES = ["USD", "INR"] as const;
export const CurrencySchema = z.enum(CURRENCIES);

export const PARAMETER_SOURCES = ["user", "ai", "template", "benchmark", "imported"] as const;
export const ParameterSourceSchema = z.enum(PARAMETER_SOURCES);

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);

export const BUSINESS_STAGES = ["idea", "pre-launch", "pre-seed", "seed", "growth", "scale"] as const;
export const BusinessStageSchema = z.enum(BUSINESS_STAGES);

// ─── Parameters (assumptions) ──────────────────────────────────────────────

export const DistributionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed") }),
  z.object({ type: z.literal("uniform"), min: finiteNumber, max: finiteNumber }),
  z.object({ type: z.literal("normal"), mean: finiteNumber.optional(), stdDev: finiteNumber }),
  z.object({ type: z.literal("triangular"), min: finiteNumber, mode: finiteNumber, max: finiteNumber }),
  /** Log-normal parameterised by the mean and standard deviation of the value itself (not of its log). */
  z.object({ type: z.literal("lognormal"), mean: finiteNumber, stdDev: finiteNumber }),
  z.object({
    type: z.literal("discrete"),
    outcomes: z.array(z.object({ value: finiteNumber, weight: finiteNumber })).min(1),
  }),
]);

export const ParameterSchema = z.object({
  id: IdSchema,
  name: z.string().min(1, "Parameter name is required").max(120),
  /**
   * Canonical numeric value. Percentages are stored as fractions:
   * 20% → 0.2. The UI is responsible for ×100 display.
   */
  value: finiteNumber,
  /** Unit string, e.g. "USD", "USD/customers", "percent", "users". */
  unit: z.string().max(40).default("number"),
  min: finiteNumber.optional(),
  max: finiteNumber.optional(),
  distribution: DistributionSchema.optional(),
  source: ParameterSourceSchema.default("user"),
  confidence: ConfidenceSchema.optional(),
  /** AI-created assumptions stay "pending" until the user accepts them. */
  status: z.enum(["accepted", "pending", "rejected"]).default("accepted"),
  description: z.string().max(2000).optional(),
});

// ─── Nodes ─────────────────────────────────────────────────────────────────

export const PositionSchema = z.object({ x: finiteNumber, y: finiteNumber });

export const NodeMetadataSchema = z.object({
  source: ParameterSourceSchema.optional(),
  confidence: ConfidenceSchema.optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(2000).optional(),
});

const baseNode = {
  id: IdSchema,
  label: z.string().min(1, "Node label is required").max(120),
  description: z.string().max(2000).optional(),
  /** Maps a slot name (see node catalog) to a parameter ID. */
  parameters: z.record(z.string(), IdSchema).default({}),
  position: PositionSchema.default({ x: 0, y: 0 }),
  /** Display unit of the node's main output, e.g. "customers" or "USD". */
  unit: z.string().max(40).optional(),
  metadata: NodeMetadataSchema.optional(),
};

const periodIndex = z.number().int().min(1);

export const GROWTH_TYPES = ["compound", "linear", "absolute"] as const;
export const REVENUE_TYPES = ["subscription", "usage", "topup", "other"] as const;
export const COST_TYPES = ["fixed", "variable", "percentage", "step"] as const;
export const COST_CLASSES = ["cogs", "opex"] as const;
export const COST_CATEGORIES = ["payroll", "marketing", "infrastructure", "ai", "payment", "rent", "software", "other"] as const;
export const COMPARISON_OPERATORS = [">", ">=", "<", "<=", "==", "!="] as const;

export const StepTierSchema = z.object({
  /** Inclusive upper bound of volume for this tier; omit for the final open-ended tier. */
  upTo: finiteNumber.optional(),
  cost: finiteNumber,
});

export const SplitBranchSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Branch key must start with a letter and use letters, digits or '_'"),
  label: z.string().min(1).max(60),
});

const emptyConfig = z.object({}).default({});

export const NodeSchema = z.discriminatedUnion("type", [
  z.object({ ...baseNode, type: z.literal("INPUT"), config: emptyConfig }),
  z.object({
    ...baseNode,
    type: z.literal("GROWTH"),
    config: z
      .object({
        growthType: z.enum(GROWTH_TYPES).default("compound"),
        /** Growth is applied from the period after this one. */
        startPeriod: periodIndex.default(1),
        /** Growth stops after this period (value stays flat). */
        endPeriod: periodIndex.optional(),
      })
      .default({ growthType: "compound", startPeriod: 1 }),
  }),
  z.object({ ...baseNode, type: z.literal("ACQUISITION"), config: emptyConfig }),
  z.object({ ...baseNode, type: z.literal("CONVERSION"), config: emptyConfig }),
  z.object({ ...baseNode, type: z.literal("CUSTOMERS"), config: emptyConfig }),
  z.object({
    ...baseNode,
    type: z.literal("CHURN"),
    config: z
      .object({
        /** "per_period": the rate applies each time step. "annual": converted to the time step. */
        basis: z.enum(["per_period", "annual"]).default("per_period"),
      })
      .default({ basis: "per_period" }),
  }),
  z.object({
    ...baseNode,
    type: z.literal("SPLIT"),
    config: z.object({ branches: z.array(SplitBranchSchema).min(1, "A split needs at least one branch").max(20) }),
  }),
  z.object({ ...baseNode, type: z.literal("PRICE"), config: emptyConfig }),
  z.object({
    ...baseNode,
    type: z.literal("REVENUE"),
    config: z.object({ revenueType: z.enum(REVENUE_TYPES).default("subscription") }).default({ revenueType: "subscription" }),
  }),
  z.object({
    ...baseNode,
    type: z.literal("COST"),
    config: z.object({
      costType: z.enum(COST_TYPES),
      costClass: z.enum(COST_CLASSES).default("opex"),
      category: z.enum(COST_CATEGORIES).default("other"),
      startPeriod: periodIndex.optional(),
      endPeriod: periodIndex.optional(),
      tiers: z.array(StepTierSchema).max(50).optional(),
    }),
  }),
  z.object({ ...baseNode, type: z.literal("POOL"), config: emptyConfig }),
  z.object({ ...baseNode, type: z.literal("CASH"), config: emptyConfig }),
  z.object({ ...baseNode, type: z.literal("FLOW"), config: emptyConfig }),
  z.object({ ...baseNode, type: z.literal("CAPACITY"), config: emptyConfig }),
  z.object({
    ...baseNode,
    type: z.literal("CONDITION"),
    config: z
      .object({
        operator: z.enum(COMPARISON_OPERATORS).default(">"),
        /** When set, an event with this label is recorded each period the condition is true. */
        eventLabel: z.string().max(120).optional(),
      })
      .default({ operator: ">" }),
  }),
  z.object({
    ...baseNode,
    type: z.literal("FORMULA"),
    config: z.object({ expression: z.string().min(1, "Formula expression is required").max(2000) }),
  }),
]);

// ─── Connections ───────────────────────────────────────────────────────────

export const ConnectionSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  sourcePort: z.string().min(1).default("out"),
  target: IdSchema,
  targetPort: z.string().min(1),
});

// ─── Scenarios ─────────────────────────────────────────────────────────────

export const ScenarioOverrideSchema = z.object({
  parameterId: IdSchema,
  value: finiteNumber.optional(),
  distribution: DistributionSchema.optional(),
});

export const ScenarioSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(["base", "upside", "downside", "custom"]).default("custom"),
  /** Scenario this one inherits overrides from (e.g. "Pricing +20%" built on "Upside"). */
  parentId: IdSchema.optional(),
  overrides: z.array(ScenarioOverrideSchema).default([]),
});

// ─── Guardrails ────────────────────────────────────────────────────────────

export const GuardrailSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  /** Timeline metric key, e.g. "grossMargin", "runwayMonths", "cash". */
  metric: z.string().min(1),
  operator: z.enum([">", ">=", "<", "<="]),
  threshold: finiteNumber,
  severity: z.enum(["warning", "critical"]).default("warning"),
  enabled: z.boolean().default(true),
});

// ─── Settings & model ──────────────────────────────────────────────────────

export const SimulationSettingsSchema = z.object({
  /** "YYYY-MM" or "YYYY-MM-DD". */
  startDate: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, "Start date must be YYYY-MM or YYYY-MM-DD"),
  timeStep: TimeStepSchema.default("monthly"),
  /** Number of time steps to simulate. */
  horizon: z.number().int().min(1, "Horizon must be at least 1 period").max(1000, "Horizon is limited to 1000 periods"),
  seed: z.number().int().min(0).max(2 ** 32 - 1).default(1),
  currency: CurrencySchema.default("USD"),
});

export const ModelMetadataSchema = z.object({
  stage: BusinessStageSchema.optional(),
  templateId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export const ModelSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().min(1, "Model name is required").max(200),
  description: z.string().max(5000).default(""),
  version: z.number().int().min(1).default(1),
  settings: SimulationSettingsSchema,
  nodes: z.array(NodeSchema).max(2000),
  connections: z.array(ConnectionSchema).max(10000).default([]),
  parameters: z.array(ParameterSchema).max(5000).default([]),
  scenarios: z.array(ScenarioSchema).max(200).default([]),
  guardrails: z.array(GuardrailSchema).max(200).default([]),
  metadata: ModelMetadataSchema.default({}),
});

// ─── Simulation runs & results ─────────────────────────────────────────────

export const SimulationRequestSchema = z.object({
  id: IdSchema,
  modelId: IdSchema,
  modelVersion: z.number().int().min(1),
  scenarioId: IdSchema.optional(),
  mode: z.enum(["single", "monte_carlo"]).default("single"),
  runs: z.number().int().min(1).max(100000).optional(),
  settings: SimulationSettingsSchema,
});

const nullableNumber = finiteNumber.nullable();

export const TimelinePointSchema = z.object({
  index: z.number().int().min(1),
  period: z.string(),
  startDate: z.string(),
  customers: z.object({
    opening: finiteNumber,
    new: finiteNumber,
    churned: finiteNumber,
    closing: finiteNumber,
  }),
  revenue: z.object({
    subscription: finiteNumber,
    usage: finiteNumber,
    topups: finiteNumber,
    other: finiteNumber,
    total: finiteNumber,
  }),
  costs: z.object({
    cogs: finiteNumber,
    opex: finiteNumber,
    byCategory: z.record(z.string(), finiteNumber),
    total: finiteNumber,
  }),
  profit: z.object({
    grossProfit: finiteNumber,
    grossMargin: nullableNumber,
    operatingProfit: finiteNumber,
  }),
  cash: z.object({
    opening: finiteNumber,
    inflow: finiteNumber,
    outflow: finiteNumber,
    closing: finiteNumber,
  }),
  metrics: z.record(z.string(), nullableNumber),
  /** Every node's port values for this period — the audit trail behind "Why?". */
  nodes: z.record(z.string(), z.record(z.string(), finiteNumber)),
});

export const SimulationEventSchema = z.object({
  period: z.number().int().min(1),
  type: z.enum(["break_even", "cash_negative", "capacity_exceeded", "condition", "margin_warning", "guardrail"]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string(),
  nodeId: z.string().optional(),
  guardrailId: z.string().optional(),
});

export const GuardrailResultSchema = z.object({
  guardrailId: IdSchema,
  /** Periods (1-based) in which the guardrail was violated. */
  violations: z.array(z.number().int().min(1)),
  passed: z.boolean(),
});

export const SimulationSummarySchema = z.object({
  mrr: finiteNumber,
  arr: finiteNumber,
  revenue: finiteNumber,
  customers: finiteNumber,
  grossMargin: nullableNumber,
  /** null when the model has no Cash node. */
  cash: nullableNumber,
  burn: finiteNumber,
  runwayMonths: nullableNumber,
  breakEvenPeriod: z.number().int().min(1).nullable(),
  cashOutPeriod: z.number().int().min(1).nullable(),
});

export const SimulationResultSchema = z.object({
  runId: z.string(),
  modelId: z.string(),
  modelVersion: z.number().int(),
  scenarioId: z.string().nullable(),
  seed: z.number().int(),
  settings: SimulationSettingsSchema,
  timeline: z.array(TimelinePointSchema),
  summary: SimulationSummarySchema,
  events: z.array(SimulationEventSchema),
  guardrails: z.array(GuardrailResultSchema),
});

// ─── Metrics, reports, templates ───────────────────────────────────────────

export const MetricDefinitionSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.enum(["currency", "percent", "count", "months", "number"]),
  description: z.string(),
  higherIsBetter: z.boolean().optional(),
});

export const ReportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum([
    "executive_summary",
    "current_state",
    "assumptions",
    "revenue",
    "costs",
    "profitability",
    "cash",
    "runway",
    "customers",
    "risks",
    "sensitivity",
    "scenarios",
    "monte_carlo",
    "recommendations",
  ]),
  /** Plain-text/markdown body generated from engine data. */
  body: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const ReportSchema = z.object({
  id: IdSchema,
  modelId: IdSchema,
  modelVersion: z.number().int().min(1),
  runId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  sections: z.array(ReportSectionSchema),
});

export const TemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(["saas", "ai-saas", "usage-saas", "credit-saas", "marketplace", "api", "other"]),
  version: z.string().default("1.0"),
  stages: z.array(BusinessStageSchema).optional(),
  model: ModelSchema,
});
