# Node System

A model is plain JSON (`@fin/model-schema`): `nodes`, `connections`, `parameters`,
`scenarios`, `guardrails` and `settings`.

- **Parameter**: an assumption with `value`, `unit`, `min`, `max`, `distribution`,
  `source` (user, ai, template, benchmark, imported), `confidence` and `status`.
  Percentages are stored as fractions (7% → `0.07`).
- **Node**: `{ id, type, label, parameters: { slot → parameterId }, config, position }`.
- **Connection**: `{ source, sourcePort = "out", target, targetPort }`.
- **Slot**: a named input. Its value is the sum of its connections, else the bound
  parameter, else the slot default.

## Node types

| Type | Slots | Outputs | Logic |
|---|---|---|---|
| INPUT | value | out | value |
| GROWTH | base, rate | out | compound / linear / absolute, with optional start and end period |
| ACQUISITION | budget, cac, organic | out, paid, organic, spend | budget ÷ CAC + organic |
| CONVERSION | input*, rate (0–100%) | out | input × rate |
| CUSTOMERS | initial, new*, churnRate | out, opening (lagged), new, churned | opening + new − opening × churn |
| CHURN | rate | out | per period, or annual converted to the step |
| SPLIT | input*, weight.<branch> | one per branch | input × weight; weights must total 100% |
| PRICE | price, discount | out | price × (1 − discount) |
| REVENUE | quantity*, price | out | quantity × price |
| COST fixed | amount, growth | out | amount × (1 + growth)^(t − start), within the start/end window |
| COST variable | volume*, unitCost | out | volume × unit cost |
| COST percentage | base*, rate | out | base × rate |
| COST step | volume* (+ tiers) | out | cost of the first tier with volume ≤ upTo |
| POOL | initial, inflow*, outflow*, minimum, maximum | out, opening (lagged), inflow, outflow, overflow, shortfall | clamped stock |
| CASH | initial, inflow*, outflow* | out, opening (lagged), inflow, outflow | opening + in − out |
| FLOW | amount*, multiplier | out | amount × multiplier |
| CAPACITY | demand*, capacity | out (served), excess, utilization | emits "capacity exceeded" |
| CONDITION | value, threshold, then, else | out, active | if(value op threshold, then, else); optional event |
| FORMULA | one per variable | out | sandboxed expression (see formula-engine.md) |

`*` marks slots that accept multiple connections, which are summed.

The catalog (`NODE_CATALOG`, `slotsFor`, `outputsFor`) is the single source of
truth for ports. The UI, validators, engine and AI tools all read it. Nothing
HERE-specific is built in: the HERE template (Phase 27) will compose these primitives.
