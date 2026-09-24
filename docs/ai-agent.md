# AI Agent

The AI is **not** the financial engine. It extracts assumptions and operates the model through validated tools. Every number it reports comes from the engine.

## Layers (`@fin/ai`, provider-independent)
- `LLMProvider { listModels, chat, stream, structured, tools }`.
- `OllamaProvider` is server-side and uses the native `/api/chat` (tools, JSON-schema `format`, NDJSON streaming) and `/api/tags`.
- `ProxyProvider` runs in the browser and calls the app's `/api/ai/{status,complete,stream}` routes. The provider URL comes only from server environment variables, and request bodies are validated with Zod, including model name format and size limits.
- `runAgent` is the tool-calling loop. Arguments are validated with Zod before a handler runs. Unknown tools, bad arguments and handler errors go back to the model as error results. It stops after 10 steps.
- `generateWithRepair` runs AI output → Zod and domain validation → errors → AI repair, up to **3 repairs**. If the output is still invalid, it returns the errors and never a value.
- `ScriptedProvider` gives deterministic replies for tests (fixed prompts → expected structured outputs).

## Model generator (Phase 17)
Prompt → structured extraction of the business type, a summary, assumptions from a fixed vocabulary (visitors, growth, conversion, price, churn, COGS, fees, fixed costs, payroll, marketing/CAC, starting customers and cash, usage), and questions.

1. Each assumption is tagged `user` (with a quote from the description) or `ai` (with confidence and a reason).
2. The AI is told never to invent visitors, price, churn, cash or payroll. It asks instead.
3. The user reviews the table, fills gaps and unticks suggestions.
4. A **deterministic builder** (`apps/web/src/ai/builder.ts`) assembles the graph from the node library.
5. Full validation runs. An invalid model is not created, and its problems are shown.

There is no Cash node unless starting cash is known. Why not have the model write graph JSON directly? Local models produce unreliable port-level graphs. Building from reviewed assumptions guarantees a sound structure, and the copilot's tools can extend it afterwards.

## Copilot tools (Phase 18)
`get_model`, `get_node`, `get_connections`, `create_node`, `update_node`, `delete_node`, `connect_nodes`, `disconnect_nodes`, `update_assumption`, `create_scenario`, `validate_model`, `run_simulation`, `compare_scenarios`, `run_monte_carlo`, `get_metric`, `get_timeline`, `run_sensitivity_analysis`, `explain_metric`, `find_bottleneck`.

- Edits use the same model operations as the canvas, go through the editor (undoable with ⌘Z) and are validated. An invalid value is refused with the validator's message.
- `compare_scenarios` returns engine-computed differences, so the AI never does arithmetic on results.
- Names are matched leniently: "churn_double" finds "Churn double".

## Assumption review (Phase 20)
- AI-suggested assumptions are stored with `source: "ai"`, a `confidence` and `status: "pending"`. They show an *AI suggested* chip and a canvas banner, and produce a validator warning.
- **Accept** keeps the value (and the AI tag). **Edit** jumps to the node, and editing makes the value the user's.
- **Reject** removes an AI-only cost node (such as "Payment fees"), or falls back to a documented default for optional inputs. Otherwise it marks the assumption rejected, which is a validation error that blocks simulation until the user enters a value. An invented number is never silently kept.
- The model review (PRD §96) shows ✓/⚠ for revenue, acquisition, churn, variable costs, payroll or fixed costs, starting cash and payment processing, with a simulation confidence of High, Medium or Low.
