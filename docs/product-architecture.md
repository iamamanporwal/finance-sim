# Product Architecture — Visual Financial Simulator

## 1. Product goal

A visual business-model builder. Users connect business assumptions into a graph,
simulate the business forward in time, run scenarios and Monte Carlo simulations,
and understand the resulting financial outcomes.

> "Tell us how your business works. We'll turn it into a simulation."

Guiding principle: **never hide the logic.** Every output must be traceable to the
assumptions and formulas that produced it. The simulation engine is the single
source of truth. The UI, the database and the AI never calculate financial results.

Core loop:

```text
DEFINE BUSINESS → BUILD MODEL → SIMULATE → UNDERSTAND → CHANGE ASSUMPTIONS → SIMULATE AGAIN
```

It should feel like n8n + Figma + a financial simulator + an AI copilot. It should
not feel like "Excel with prettier charts".

## 2. User personas

| Persona | Knows | Needs |
|---|---|---|
| Founder | The business, not financial modeling | Templates, plain English, runway, scenarios |
| Product manager | Product levers | Financial impact of pricing, free tiers, AI features |
| Startup operator | Operations | Detailed assumptions, headcount, costs, forecasts |
| Finance professional | Modeling | Formula transparency, reproducibility, exports, audit trail |

## 3. Core workflow

1. Create a model (blank, template, or described to AI).
2. Add and connect nodes (assumptions → drivers → outputs).
3. Edit assumptions in the properties panel. Formulas are never required.
4. Validate. An invalid model never runs silently.
5. Run a deterministic simulation (for example 24 monthly steps).
6. Read the dashboard, timeline (every period is inspectable) and events.
7. Change an assumption, then see what changed and why.
8. Run scenarios (overrides only), Monte Carlo and sensitivity analysis.
9. Export a report generated from engine data.

## 4. Major modules

```text
/apps/web                    Next.js App Router UI (Phase 6+)
/packages/formula-engine     Safe expression language: tokenizer, parser, Decimal evaluator, unit checking
/packages/model-schema       Zod schemas and TS types for every domain concept, node type catalog, semantic validators
/packages/simulation-engine  Time engine, dependency graph, node evaluators, simulation loop, incremental recalculation
/packages/monte-carlo        (Phase 12) seeded sampling, chunked runs, percentile statistics, Web Worker entry
/packages/ai                 (Phase 16+) LLM provider abstraction (Ollama first), tools, repair loop
```

Dependency direction is one-way. The UI and AI depend on the engine, never the reverse:

```text
formula-engine  ←  model-schema  ←  simulation-engine  ←  monte-carlo  ←  apps/web
                                                      ←  ai (tools call the engine)
```

## 5. Technical architecture

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) | Shared types from schema to UI |
| Monorepo | pnpm workspaces; packages consumed from source | No build step for internal packages |
| Validation | Zod | JSON-serializable models, AI output validation |
| Money math | decimal.js | No floating-point drift in financial values |
| Tests | Vitest | Fast, ESM-native |
| UI (Phase 6+) | Next.js App Router, MUI v7, @xyflow/react, Zustand | Per PRD |
| Persistence (later) | PostgreSQL / Supabase | The engine never depends on it |
| Heavy compute | Web Workers in the browser | Vercel Hobby friendly, no long server jobs |

Repository state at Phase 0: the repository was empty apart from the PRD and the
plan. There was no existing framework, authentication, database, deployment config,
design system, AI integration, environment variables or test setup, so there was
nothing to preserve.

## 6. Domain model and data flow

A **Model** is plain JSON:

```text
Model { id, name, description, version, settings, nodes[], connections[], parameters[], scenarios[], guardrails[], metadata }
```

- **Parameter** is an assumption: `{ id, name, value, unit, min?, max?, distribution?, source, confidence?, description? }`.
  Percent values are stored as **fractions** (20% → `0.2`). The UI multiplies by 100 for display.
- **Node** is a typed calculation step: `{ id, type, label, parameters: { slot → parameterId }, config, position }`.
- **Connection** runs from an output port to an input port: `{ id, source, sourcePort, target, targetPort }`.
- **Scenario** is a set of overrides of parameter values. The base model is never copied.

Every node type declares **slots** (named inputs). A slot's value comes from a
connected upstream port, or else from the node's parameter for that slot, or else
from the slot's default. For example, a Conversion node's `rate` can be typed in
directly or wired from an Input node. Multi-input slots (such as `Cash.inflow`)
sum their connections.

```text
JSON model ──zod──► validated model ──compile──► dependency graph + topological order
                                                    │
                        settings (start, step, horizon, seed)
                                                    ▼
                              for each period: evaluate nodes in order
                                                    ▼
                        SimulationResult { timeline[], summary, events[], nodeOutputs }
                                                    ▼
                           dashboard / timeline / reports / AI explanations
```

## 7. Simulation architecture

Concepts: **stock** (accumulates: Customers, Cash, Pool), **flow** (per period:
signups, revenue, costs), **rate** (growth, churn, conversion), **capacity**,
**assumption** (parameter) and **output** (metric).

Time engine: `startDate`, `timeStep` (daily, weekly, monthly, quarterly, yearly;
default monthly), `horizon` (number of steps) and `seed`. Rates are interpreted
per time step.

Loop (pure TypeScript, no React, runs in browser, Node, tests and Web Workers):

```text
initialize state (stocks at initial balances, growth factors at 1)
for each period t:
    resolve inputs         parameter values (base or scenario override)
    resolve dependencies   nodes in topological order
    calculate flows        conversion, revenue, costs...
    update pools           stocks: closing = opening + inflow − outflow
    calculate metrics      revenue, COGS, gross profit and margin, burn, runway, MRR/ARR
    evaluate conditions    capacity exceeded, break-even, cash below zero
    record timeline state  every node's port values are kept for traceability
```

- **Determinism**: same model, parameters and seed give identical results. All
  randomness goes through a seeded PRNG.
- **Feedback loops**: a stock's `opening` output is *lagged* (known at period start),
  so edges from it do not create same-period cycles. Any other cycle is rejected
  with `Circular dependency detected. A → B → C → A`.
- **Incremental recalculation**: changing a parameter marks its node and every node
  downstream of it dirty. Only dirty nodes are re-evaluated. Cached outputs are reused
  for the rest (for example, Office Rent is untouched when Growth changes).
- **Financial aggregation** is driven by node roles, not by template logic:
  `REVENUE` nodes add to revenue by type (subscription, usage, top-up, other).
  `COST` nodes add to COGS or OpEx by category. `ACQUISITION` spend adds to marketing.
  `CASH` nodes form the cash balance. Nothing HERE-specific lives in the engine.
- **Errors, not NaN**: division by zero, a missing required input or an invalid range
  produces an explicit error. Undefined metrics (runway when not burning, margin with
  no revenue) are `null` and are displayed as "n/a" or "Not burning".

## 8. AI architecture (Phase 16+)

```text
Prompt → intent extraction → entities → assumptions → graph JSON → Zod validation
       → semantic validation → (repair loop, max 3) → canvas
```

- Provider interface `LLMProvider { chat, stream, structured, tools }`. Ollama comes first
  (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`). Cloud providers plug in later, server-side only.
- The AI acts only through validated tools (`create_node`, `update_assumption`,
  `run_simulation`, …). It never writes to the database and never computes financial
  outputs. Explanations quote engine values.
- Every AI-created parameter carries `source: "ai"` and a confidence level, and needs
  the user's approval.

## 9. Deployment architecture

- Target: Vercel Hobby. There are no long-running server processes. Monte Carlo and
  sensitivity analysis run in Web Workers in the browser, chunked, with progress events.
- Local mode: browser → local Next.js → local Ollama. Cloud mode: browser → Vercel
  function → cloud LLM, with API keys only on the server.
- The marketing route stays static. Canvas, charts and engine are lazy-loaded on
  `/app` routes.
