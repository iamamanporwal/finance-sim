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
| 6 | Canvas (React Flow + MUI v7 + Zustand), shortcuts, undo/redo, copy/paste, ⌘K | Done |
| 7 | Node library with search and drag-to-canvas | Done |
| 8 | Properties panel (value, uncertainty, source; advanced collapsed) | Done |
| 9 | Results dashboard (KPI cards, charts, What changed?) | Done |
| 10 | Timeline (every period inspectable, events, guardrails) | Done |
| 11+ | Scenarios UI, Monte Carlo, sensitivity, AI… | Not started |

## Layout

```text
apps/web/             Next.js App Router UI (canvas, library, properties, dashboard, timeline)
packages/
  formula-engine/     tokenizer, parser, Decimal evaluator, unit checking. No eval.
  model-schema/       Zod schemas, TS types, node catalog, metrics, validators, example model
  simulation-engine/  time engine, dependency graph, node evaluators, Simulator, financial aggregation
docs/                 architecture and engine docs
```

## Commands

```bash
pnpm install
pnpm dev         # http://localhost:3000 → /app
pnpm build       # production build of apps/web
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

## Using the app

Open `/app`, then pick **Subscription SaaS** or **Build from scratch**. Models are saved in this browser (localStorage).

- **Build**: drag nodes from the library (or ⌘K → "Add node"), connect output ports (right) to input ports (left), and edit assumptions in the Properties panel. The model re-simulates automatically and the bottom bar shows the result.
- **Simulate**: set the start, time step, horizon and seed, and see the validation checklist. An invalid model is blocked, never run.
- **Results**: KPI cards, charts and the timeline. Click any period, or any point on a chart, to see its details.

Shortcuts: ⌘Z / ⌘⇧Z undo and redo · Delete removes the selection · ⌘C / ⌘V copy and paste · ⌘D duplicates · ⌘S saves · ⌘K opens the command palette · ⌘↵ runs · Space + drag pans · Shift + drag selects several nodes.
