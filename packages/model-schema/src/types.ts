import type { z } from "zod";
import type {
  ConnectionSchema,
  DistributionSchema,
  GuardrailResultSchema,
  GuardrailSchema,
  MetricDefinitionSchema,
  ModelSchema,
  NodeSchema,
  ParameterSchema,
  ReportSchema,
  ReportSectionSchema,
  ScenarioOverrideSchema,
  ScenarioSchema,
  SimulationEventSchema,
  SimulationRequestSchema,
  SimulationResultSchema,
  SimulationSettingsSchema,
  SimulationSummarySchema,
  TemplateSchema,
  TimelinePointSchema,
} from "./schemas";
import type {
  BUSINESS_STAGES,
  CONFIDENCE_LEVELS,
  COST_CATEGORIES,
  NODE_CATEGORIES,
  NODE_TYPES,
  PARAMETER_SOURCES,
  REVENUE_TYPES,
  TIME_STEPS,
} from "./schemas";

export type NodeType = (typeof NODE_TYPES)[number];
export type NodeCategory = (typeof NODE_CATEGORIES)[number];
export type TimeStep = (typeof TIME_STEPS)[number];
export type ParameterSource = (typeof PARAMETER_SOURCES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type BusinessStage = (typeof BUSINESS_STAGES)[number];
export type RevenueType = (typeof REVENUE_TYPES)[number];
export type CostCategory = (typeof COST_CATEGORIES)[number];

/** Parsed (defaults applied) shapes — what the engine works with. */
export type Model = z.output<typeof ModelSchema>;
export type ModelNode = z.output<typeof NodeSchema>;
export type Connection = z.output<typeof ConnectionSchema>;
export type Parameter = z.output<typeof ParameterSchema>;
export type Distribution = z.output<typeof DistributionSchema>;
export type Scenario = z.output<typeof ScenarioSchema>;
export type ScenarioOverride = z.output<typeof ScenarioOverrideSchema>;
export type Guardrail = z.output<typeof GuardrailSchema>;
export type SimulationSettings = z.output<typeof SimulationSettingsSchema>;
export type SimulationRequest = z.output<typeof SimulationRequestSchema>;
export type TimelinePoint = z.output<typeof TimelinePointSchema>;
export type SimulationEvent = z.output<typeof SimulationEventSchema>;
export type GuardrailResult = z.output<typeof GuardrailResultSchema>;
export type SimulationSummary = z.output<typeof SimulationSummarySchema>;
export type SimulationResult = z.output<typeof SimulationResultSchema>;
export type MetricDefinition = z.output<typeof MetricDefinitionSchema>;
export type ReportSection = z.output<typeof ReportSectionSchema>;
export type Report = z.output<typeof ReportSchema>;
export type Template = z.output<typeof TemplateSchema>;

/** Input shapes — what may be written by hand, by a template or by the AI (defaults optional). */
export type ModelInput = z.input<typeof ModelSchema>;
export type ModelNodeInput = z.input<typeof NodeSchema>;
export type ParameterInput = z.input<typeof ParameterSchema>;

export type NodeOfType<T extends NodeType> = Extract<ModelNode, { type: T }>;
