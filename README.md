# Visual Financial Simulator

Build your business model like a workflow. Connect assumptions together, run the business forward in time and see what happens.

See [PRD.TXT](PRD.TXT) for the product and [Plan.txt](Plan.txt) for the phased build plan.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Product architecture ([docs/product-architecture.md](docs/product-architecture.md)) | Done |
| 1 | Domain model and validation (`packages/model-schema`) | Done |
| 2 | Safe formula engine (`packages/formula-engine`) | Done |
| 3 | Time engine | Done |
| 4 | Basic financial nodes and acceptance test | Done |
| 5 | Dependency graph, cycle detection, incremental recalculation | Done |
| 6+ | Canvas UI, dashboard, scenarios UI, Monte Carlo, AI… | Not started |

There is no UI yet. The engine runs in Node, in tests, and, once Phase 12 lands, in Web Workers.

## Layout

```text
packages/
  formula-engine/     tokenizer, parser, Decimal evaluator, unit checking. No eval.
  model-schema/       Zod schemas, TS types, node catalog, metrics, validators, example model
  simulation-engine/  time engine, dependency graph, node evaluators, Simulator, financial aggregation
docs/                 architecture and engine docs
```

## Commands

```bash
pnpm install
pnpm test        # vitest, all packages
pnpm typecheck   # tsc --noEmit
pnpm check       # both
```

## Quick example

```ts
import { acceptanceModel } from "@fin/model-schema";
import { simulate, Simulator } from "@fin/simulation-engine";

const result = simulate(acceptanceModel());         // 24 monthly periods
result.timeline[11].metrics.mrr;                      // month-12 MRR
result.summary.breakEvenPeriod;                       // 7

const sim = new Simulator(acceptanceModel());
sim.run();
const { recomputed } = sim.setParameter("p_growth", 0.1).recalculate();
// recomputed = only the nodes downstream of growth
```
