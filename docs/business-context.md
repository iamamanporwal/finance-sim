# Business context: current state, actuals, stage, templates, versions, export

Phases 21–29. Everything here reads from or writes to the model; the engine stays generic.

## "Why?" (Phase 21)

`explainWhy(model, result, { metric } | { nodeId, port }, { period })` in `packages/simulation-engine/src/why.ts` walks the dependency graph from a metric or node down to its assumptions. Every step carries:

- the engine value for that period (from `result.timeline[p].nodes`, never recomputed);
- the node's formula with the values filled in: `quantity × price = 8,695 × $29 = $252.16K`;
- for assumptions: source (user, AI, template, imported) and confidence.

Stocks stop at their opening balance ("closing balance of the previous period"), and a node reached twice is marked "explained above". The main chain (e.g. `MRR ← Subscription revenue ← Customers ← Conversion ← Signups`) follows the largest input at each step.

The **Why dialog** is available on every KPI card, every metric row in the period detail, every node output in the properties panel, and in ⌘K. "Explain with AI" sends the tree as text to the local model, then checks every number in the reply against the engine values (`ungroundedNumbers` in `packages/ai/src/grounding.ts`: rounding is allowed, computing new figures is not). A reply that fails the check goes back for repair (up to 3 times); if it still fails, only the deterministic explanation is shown.

## What-if commands (Phase 22)

Copilot tools `what_if`, `compare_options` and `create_standard_scenarios`, plus `run_monte_carlo`, which now accepts a scenario and up to 10,000 runs, and `explain_metric`, which now uses the Why tree. What-ifs are always scenarios (overrides), so the base model does not change. A change target is either an assumption or a cost category (`ai`, `payroll`, `marketing`, …):

| Command | Tool call |
|---|---|
| Increase pricing by 20% | `what_if {target: "Price", change_percent: 0.2}` |
| What happens if churn doubles? | `what_if {target: "Monthly churn", change_percent: 1}` |
| What happens if AI costs increase 50%? | `what_if {target: "ai", change_percent: 0.5}` — every AI cost line |
| Run a downside scenario | `create_standard_scenarios` |
| Compare hiring vs marketing | `compare_options` — hiring with no payroll line adds a $0 line to the base model (base results unchanged); marketing without an acquisition node asks the user for CAC instead of inventing it |
| Run 10,000 simulations | `run_monte_carlo {runs: 10000}` — if nothing has a range, visible ±25% ranges are added first (undoable) and reported |

The copilot must not answer these conversationally. If it replies without calling a tool to a request that needs one, it is sent back once to use the tools (`apps/web/src/ai/intent.ts`). If a local model stops with an empty reply mid-task, the agent loop asks it to continue (up to 2 times).

## Current state (Phase 23)

`model.currentState`: as-of month, MRR, customers, cash, growth, churn, monthly expenses, gross margin. These are facts the user enters, shown in a **Current state · actual** panel separate from the **Forecast · simulated** section. "Start the forecast from today" sets starting customers and starting cash, and moves the start month to the next month. This happens only where a single node clearly holds the value; a model with one Customers node per plan is reported instead of guessed. Changed parameters get source `imported`. Mismatches between today and the forecast's first period are flagged.

## Actuals vs forecast (Phase 24)

`model.actuals[]`: one row per month (revenue, MRR, customers, new, churned, COGS, opex, cash), entered in a table or pasted from a spreadsheet/CSV (`parseActualsCsv` accepts `2026-06`, `06/2026`, `Jun 2026`, `$12,400`, `(5,000)`). `actualsVsForecast` gives:

```text
Jan Feb Mar Apr | May Jun Jul …
 A   A   A   A  |  F   F   F
```

Months before the forecast are history (A); actuals inside the forecast get a variance against what the model forecast. "Start the forecast after the latest actuals" applies `anchorFromActuals` (latest customers, latest cash, next month). The timeline shows actual months with a divider before M1.

## Business stage (Phase 25)

Stages are Idea, Pre-launch, Pre-seed, Seed, Growth and Scale (`apps/web/src/lib/business-context.ts`). A stage chooses the dashboard's focus metrics and its reading guidance, which templates are recommended, and the onboarding. Onboarding asks the PRD's four questions: what are you building, how do you make money, what is your stage, and what are your biggest questions. Each question is answered on the dashboard from engine output, for example "Will I run out of cash? Not within the forecast: cash stays positive through 2028-09 (lowest $534K in 2027-08)."

Health is shown per dimension (Cash, Growth, Margin, Retention), never as a single score, and each dimension shows the rule it uses. **Stage never changes a formula.** A test checks that the same model simulated with stage `idea` and with stage `scale` gives an identical timeline.

## Templates (Phase 26) and HERE (Phase 27)

`packages/templates`: SaaS, AI SaaS, Usage-based SaaS, AI SaaS + subscription + credits, Marketplace, API business, and HERE. All values have source `template`. Every template is validated, simulated and checked for overlapping nodes in tests, and laid out by `autoLayout` (layered left-to-right, sized by each node's ports). ⌘K → "Tidy up layout" applies the same layout to any model.

New generic engine pieces (none of them HERE-specific):

| Node | Purpose |
|---|---|
| `CREDIT_WALLET` | grants + purchases in; burned = min(demand, available); rationed = unmet demand; unused credits expire at an expiry rate (breakage); optional cap |
| `REVENUE_RECOGNITION` | billed cash → deferred revenue; recognized = min(available, to-recognize + opening × rate). Cash received ≠ revenue recognized |
| `COST` type `capacity` | ⌈volume ÷ capacity per unit⌉ × cost per unit, with units and utilization (e.g. guardians per 120 accounts) |
| `CUSTOMERS.movedIn` | upgrades/downgrades arrive without counting as new customers |

Library presets built on them: Credit Wallet, Credit Grant, Credit Burn, Revenue Recognition, Breakage, Usage Cost, Standing Charge, Capacity Pool.

New metrics: contribution, contribution margin, new MRR, NRR (monthly), NRR (12 months), deferred revenue, credit balance, credits burned/expired, burn depth, breakage, rationing. When one wallet's unmet demand flows into another (plan allowance → top-up wallet), demand is counted once, and rationing counts only demand that is still unmet at the end.

**Custom metrics** (`model.customMetrics`) are formulas over metrics and node outputs, evaluated by the engine each period, usable in guardrails, and explainable with Why?.

**HERE**: Signups → Activation → Conversion → Plan mix → Prime / Studio / World / Dedicated (with Prime→Studio→World upgrades), plus a free Signal tier. The credit economy is plan credits (monthly allowance, which lapses), heavy-user overage, a top-up wallet, top-up billings to Cash, and Revenue Recognition. Costs are AI tokens, guardians (capacity pool), hosting, Signal hosting, storage, payment fees, payroll and marketing. Guardrails: GM > 55%, runway > 6, breakage < 8%, APG > 50, rationing < 15%, cash > 0.

> **APG and WSCB are not defined in the PRD.** The template ships APG = paid accounts ÷ guardians (an assumed definition) and WSCB = credits held per paid account (a placeholder). Both are flagged "needs confirmation" everywhere they appear until confirmed or edited under *Your business → Custom metrics*. All HERE prices, rates and costs are example values.

## Export (Phase 28)

`packages/reports/src/export.ts`, available from the ⋮ menu → Export:

| What | Formats |
|---|---|
| Model | JSON (`finsim-model`, re-importable from the home page; an import never overwrites an existing model) |
| Assumptions | CSV |
| Timeline | CSV (statements + every metric), node-values CSV (audit trail) |
| Results | JSON (summary, events, guardrails, timeline, run ID, seed) |
| Scenarios | CSV (overrides + results vs base) |
| Monte Carlo | CSV, JSON |
| Report | Markdown, PDF (browser print → Save as PDF) |

Numbers are raw (percentages as fractions). In CSV, text cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets never execute them as formulas.

## Versioning (Phase 29)

`apps/web/src/lib/versions.ts`. Every version is an immutable snapshot of the whole model: graph, parameters, scenarios, settings and seed. It also stores the base-run summary, so results can be reproduced exactly (tested). Versions are created as follows:

- ⌘S or *Save version* (with an optional name) always creates one, unless nothing changed.
- Autosave creates one at most every 10 minutes.
- Restoring creates a new "Restore" version, so history is never rewritten.

Up to 40 versions are kept, pruning automatic versions first. *Version history* lets you compare any two versions: changed assumptions (`Prime price: $29 → $35`), structure, settings, and results side by side. You can also restore a version or duplicate it into a new model. Versions are stored in this browser. The `VersionStore` interface is the seam for a database.
