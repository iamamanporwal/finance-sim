# Monte Carlo, Sensitivity, Scenarios and Guardrails

## Scenarios (`@fin/simulation-engine` · `apps/web/src/lib/scenario-ops.ts`)
- A scenario stores **overrides only** (`{ parameterId, value }`) and may build on a parent scenario. The base model is never copied or changed.
- While a scenario is active in the top bar, editing an assumption writes an override. The Properties panel shows "Overridden · base $39" with a *Reset to base* button.
- *Create Base / Upside / Downside* runs a sensitivity analysis on final cash, falling back to MRR when there is no Cash node. It then moves every assumption that has an effect by ±20% in its favorable or unfavorable direction. The directions are measured, not guessed.
- `compareScenarios(model, ids)` powers the comparison table and charts. Validators check override values against node ranges, so no scenario can set conversion above 100%.

## Monte Carlo (`@fin/monte-carlo`)
- Parameters with a distribution are sampled: uniform, normal, triangular, log-normal (mean/σ of the value) or discrete. Samples are clamped to valid bounds (`parameterBounds`), so runs never become invalid.
- Run *i* uses `deriveSeed(seed, i)`. The same seed gives identical results, and chunking does not change them (tested).
- `MonteCarloRun.step(n)` / `result()` give incremental execution. In the browser it runs in a **Web Worker** (`apps/web/src/workers/monte-carlo.worker.ts`) with progress ("432 / 1,000") and cancel.
- Output: P10/P25/P50/P75/P90, mean, min and max for final MRR, ARR, customers, cash, lowest cash and break-even period. Probabilities: profitability (final period), cash-out (any period), target MRR, target cash and any guardrail breached. Also MRR and cash histograms and per-period P10/P50/P90 bands.
- Performance: 1,000 runs of the 10-node model take about 1.3 s in the worker, and the UI stays responsive.
- If no assumption is uncertain, the UI offers "Add ±25% uncertainty to rates, prices and unit costs". Starting balances stay fixed.

## Sensitivity ("What matters most?")
`runSensitivity(model, { metric, delta })` moves each assumption −δ and +δ, one at a time, and re-runs the model. The results are ranked by swing and shown as a tornado chart, with a sentence built only from those numbers.

## Guardrails
- Rules such as `grossMargin > 0.55`, `runwayMonths > 6`, `churnRate < 0.08`, `cacPaybackMonths < 12` and `cash > 0` are checked in every period of every run. Each violation becomes a timeline event.
- `explainGuardrail(model, result, id, period)` compares the violating period with the last period that passed. For example: *"COGS grew faster than revenue since 2027-01: COGS up 50.0% ($300 → $450) while revenue was unchanged."* It uses engine data only.
- New metrics: `cac` (marketing spend ÷ new customers) and `cacPaybackMonths` (CAC ÷ monthly ARPU × gross margin).

## Reports (`@fin/reports`)
`generateReport({ model, result, scenarios?, monteCarlo?, sensitivity? })` produces 14 sections: executive summary, starting point, assumptions, revenue, costs, profitability, cash, runway, customers, risks, sensitivity, scenarios, Monte Carlo, and questions to review. Every number is read from engine output. The Report tab can print or save to PDF and copy the report as Markdown.
