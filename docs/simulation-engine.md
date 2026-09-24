# Simulation Engine (`@fin/simulation-engine`)

Pure TypeScript with no React and no I/O. It runs in the browser, Node, tests and Web Workers.

## Entry points

```ts
simulate(model, { scenarioId?, parameterOverrides?, seed?, runId? }): SimulationResult
new Simulator(model, options)      // .run(), .setParameter(id, value), .recalculate()
validateForSimulation(model)       // schema + semantic + graph issues
DependencyGraph.fromModel(model)   // topologicalOrder(), findCycle(), downstreamOf(), upstreamOf()
buildPeriods(settings)             // time engine
```

Invalid models are never run. Their errors throw `SimulationBlockedError` with the
full issue list ("Simulation blocked — 3 issues found"). Runtime problems (such as a
division by zero in period 5) throw `SimulationError` with `nodeId` and `period`.

## Loop

```text
initialize state (per-node private state; stocks start at their initial balance)
for each period t:
  1. open stocks     opening = previous closing (or initial)   → lagged `opening` port
  2. evaluate nodes  in topological order; each slot resolves as
                     connections (summed) → bound parameter → slot default
aggregate per period: revenue by type, COGS/OpEx by category, customers, cash,
                      gross margin, burn, runway, MRR/ARR, events, guardrails
```

## Time

`startDate` (YYYY-MM or YYYY-MM-DD), `timeStep` (daily, weekly, monthly, quarterly,
yearly; default monthly), `horizon` (number of steps) and `seed`. Rates are **per
time step**. CHURN nodes with `basis: "annual"` convert to the step rate. MRR is
subscription revenue ÷ months per step. Runway is in months.

## Determinism

The same model, parameter values and seed produce deep-equal results, including
`runId`. The seeded PRNG (`createRng`, `deriveSeed`) is ready for Monte Carlo
(Phase 12). Single runs use no randomness.

## Dependency graph

- Edges come from connections. An edge from an output marked `lagged` (a stock's
  `opening`) carries influence across periods but imposes no same-period ordering.
  That is how legitimate feedback loops work (referrals from opening customers,
  hiring when opening cash exceeds a threshold).
- Any other cycle is rejected: `Circular dependency detected. A → B → C → A`.
- `Simulator.setParameter` marks the nodes that use the parameter, plus everything
  downstream (lagged edges included), as dirty. `recalculate()` re-evaluates only
  those nodes and reuses cached outputs for the rest. The result is identical to a
  fresh full run, which is tested.

## Financial aggregation

| Role | Contribution |
|---|---|
| REVENUE | revenue by `revenueType` (subscription, usage, topup, other) |
| COST | COGS or OpEx by `costClass`, plus `category` breakdown |
| ACQUISITION | `spend` counts as OpEx under `marketing` |
| CUSTOMERS | opening, new, churned and closing customers (summed across stocks) |
| CASH | opening, inflow, outflow and closing cash (summed) |

Cash moves only through explicit connections into a CASH node's inflow and outflow.
Validation warns when a revenue or cost node does not reach Cash. Undefined metrics
are `null`, never NaN: margin with zero revenue, runway when not burning, and cash
when there is no Cash node.

Every timeline point keeps every node's port values (`timeline[i].nodes`). This is
the audit trail behind "Why?".

## Performance

The 24-month acceptance model takes about 1.2 ms per run on a MacBook, against a
target of under 100 ms.
