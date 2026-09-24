# Testing

```bash
pnpm check     # typecheck (packages + web) and all unit/integration tests
OLLAMA_E2E=1 pnpm vitest run apps/web/test/ai-ollama.e2e.test.ts   # live local-AI test
```

| Area | Where |
|---|---|
| Formula engine (every operator and function, units, security limits) | `packages/formula-engine/test` |
| Schema and validators | `packages/model-schema/test` |
| Engine: acceptance model (months 1–3 checked by hand, all 24 cross-checked), nodes, time, graph and cycles, incremental recalculation, sensitivity, scenarios, explanations | `packages/simulation-engine/test` |
| Monte Carlo: distribution statistics, percentiles, determinism, chunking, clamping | `packages/monte-carlo/test` |
| Reports | `packages/reports/test` |
| AI: Ollama provider against a fake HTTP API, tool loop, repair loop, request validation | `packages/ai/test` |
| Web logic: model ops, presets, scenarios, guardrails, AI generator/builder, copilot tools, assumption review | `apps/web/test` |

Browser runs (headless Chrome through `playwright-core`) cover canvas editing, scenario overrides, Monte Carlo in the worker, sensitivity, guardrails, the report, AI model generation, assumption review and copilot tool use with `gpt-oss:20b`.
