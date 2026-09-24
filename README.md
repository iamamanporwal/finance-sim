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
| 11 | Scenarios (overrides only, Base/Upside/Downside, comparison) | Done |
| 12 | Monte Carlo in a Web Worker (P10–P90, probabilities, histogram) | Done |
| 13 | Sensitivity analysis ("What matters most?") | Done |
| 14 | Guardrails (every period, engine-computed causes) | Done |
| 15 | Report generation from engine data | Done |
| 16 | AI provider layer (Ollama, server-side proxy) | Done |
| 17 | AI model generator (extraction → review → deterministic build) | Done |
| 18 | AI tool calling (copilot with 19 validated tools) | Done |
| 19 | AI repair loop (max 3 repairs) | Done |
| 20 | AI assumption review (accept/edit/reject) | Done |
| 21 | AI "Why?" (engine causal tree + grounding-checked AI explanation) | Done |
| 22 | AI "What if?" (what_if, compare_options, standard scenarios, 10,000-run Monte Carlo) | Done |
| 23 | Current state, shown separately from the forecast | Done |
| 24 | Actuals vs forecast (entry, CSV paste, A │ F timeline, variance, anchoring) | Done |
| 25 | Business stage and onboarding (context only, never formulas) | Done |
| 26 | Template library (SaaS, AI SaaS, Usage, Credits, Marketplace, API) | Done |
| 27 | HERE model from reusable nodes (credit wallet, revenue recognition, capacity cost, custom metrics) | Done |
| 28 | Export (JSON, CSV, PDF) and JSON import | Done |
| 29 | Model versioning (compare, restore, duplicate) | Done |
| 30 | Performance: measured, then optimized ([docs/performance.md](docs/performance.md)) | Done |
| 31+ | Security review, … | Not started |

Phases 21–29 are described in [docs/business-context.md](docs/business-context.md).

## Layout

```text
apps/web/             Next.js App Router UI (canvas, library, properties, dashboard, timeline)
packages/
  formula-engine/     tokenizer, parser, Decimal evaluator, unit checking. No eval.
  model-schema/       Zod schemas, TS types, node catalog, metrics, validators, example model
  simulation-engine/  time engine, dependency graph, node evaluators, Simulator, sensitivity, scenarios, explanations
  monte-carlo/        seeded sampling, statistics, incremental runs (used by the Web Worker)
  reports/            report generation, Markdown/CSV/JSON export and import
  templates/          template library (SaaS … HERE) built only from generic nodes; auto-layout
  ai/                 LLM provider interface, Ollama, proxy, agent loop, repair loop
docs/                 architecture and engine docs
```

## Commands

```bash
pnpm install
pnpm dev         # http://localhost:3000 → /app  (optional local AI: see docs/ollama.md)
pnpm build       # production build of apps/web
pnpm test        # vitest, all packages
pnpm typecheck   # tsc --noEmit
pnpm check       # both
pnpm perf        # engine performance measurements (docs/performance.md)
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
