import { executeToolCall, runAgent, ScriptedProvider, toolDefinitions } from "@fin/ai";
import { acceptanceModel, parseModel, type Model } from "@fin/model-schema";
import { runMonteCarlo } from "@fin/monte-carlo";
import { simulate } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { createCopilotTools } from "../src/ai/tools";

function harness(initial: Model = parseModel(acceptanceModel())) {
  let model = initial;
  const commits: string[] = [];
  const tools = createCopilotTools({
    getModel: () => model,
    commit: (next, summary) => {
      model = next;
      commits.push(summary);
    },
    runMonteCarlo: async (o) => runMonteCarlo(model, o),
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => executeToolCall(tools, { id: "t", name, arguments: args });
  return { tools, call, commits, get model() { return model; } };
}

describe("copilot tools", () => {
  it("exposes every tool from the plan with JSON-schema parameters", () => {
    const { tools } = harness();
    expect(tools.map((t) => t.name)).toEqual([
      "get_model", "get_node", "get_connections", "create_node", "update_node", "delete_node", "connect_nodes", "disconnect_nodes",
      "update_assumption", "create_scenario", "validate_model", "run_simulation", "compare_scenarios", "run_monte_carlo", "get_metric", "get_timeline",
      "run_sensitivity_analysis", "explain_metric", "find_bottleneck",
    ]);
    for (const d of toolDefinitions(tools)) expect(d.parameters.type).toBe("object");
  });

  it("run_simulation returns engine numbers", async () => {
    const r = await harness().call("run_simulation");
    expect(r.ok).toBe(true);
    const expected = simulate(acceptanceModel()).summary;
    expect(r.result).toMatchObject({ mrr: "$691.93K", break_even: "2027-07", cash_out: "never" });
    expect(expected.mrr).toBeCloseTo(691933.64, 1);
  });

  it("update_assumption with change_percent edits the base model through validated ops", async () => {
    const h = harness();
    const r = await h.call("update_assumption", { parameter_id: "Price", change_percent: 0.2 });
    expect(r.result).toMatchObject({ assumption: "Price", from: 39, to: 46.8, scenario: "base model", model_valid: true });
    expect(h.model.parameters.find((p) => p.id === "p_price")!.value).toBe(46.8);
    expect(h.commits).toEqual(["AI changed Price"]);
  });

  it("rejects invalid values without changing anything", async () => {
    const h = harness();
    const r = await h.call("update_assumption", { parameter_id: "p_conversion", value: 7 });
    expect(r.ok).toBe(false);
    expect((r.result as { error: string }).error).toBe("Conversion: Conversion rate must be between 0% and 100%.");
    expect(h.commits).toEqual([]);
  });

  it("create_scenario stores overrides only (\"What happens if churn doubles?\")", async () => {
    const h = harness();
    const r = await h.call("create_scenario", { name: "Churn doubles", kind: "downside", changes: [{ parameter_id: "Monthly churn", change_percent: 1 }] });
    expect(r.ok).toBe(true);
    const id = (r.result as { scenario_id: string }).scenario_id;
    expect(h.model.parameters.find((p) => p.id === "p_churn")!.value).toBe(0.05);
    expect(h.model.scenarios.find((s) => s.id === id)!.overrides).toEqual([{ parameterId: "p_churn", value: 0.1 }]);
    const sim = await h.call("run_simulation", { scenario: "Churn doubles" });
    expect((sim.result as { scenario: string }).scenario).toBe(id);
    const cmp = await h.call("compare_scenarios", { scenarios: ["Churn doubles"] });
    const [base, doubled] = cmp.result as { scenario: string; mrr: { value: string; vs_base?: string } }[];
    expect(base!.scenario).toBe("Base model");
    expect(base!.mrr.vs_base).toBeUndefined();
    expect(doubled!.mrr.vs_base).toMatch(/^−\$[\d.]+K \(−\d+\.\d%\)$/);
  });

  it("create_node + connect_nodes add a payment fee that reaches cash", async () => {
    const h = harness();
    const r = await h.call("create_node", { preset: "percentage-cost", label: "Payment fees", values: { rate: 0.029 } });
    const id = (r.result as { node_id: string }).node_id;
    expect((await h.call("connect_nodes", { from_node: "revenue", to_node: id, to_input: "base" })).ok).toBe(true);
    expect((await h.call("connect_nodes", { from_node: id, to_node: "cash", to_input: "outflow" })).ok).toBe(true);
    const fee = h.model.parameters.find((p) => p.id === h.model.nodes.find((n) => n.id === id)!.parameters.rate)!;
    expect(fee).toMatchObject({ source: "ai", status: "pending" });
    const v = await h.call("validate_model");
    expect(v.result).toMatchObject({ valid: true });
    const cogs = await h.call("get_metric", { metric: "cogs", period: 1 });
    expect((cogs.result as { value: number }).value).toBeCloseTo(448 + 2184 * 0.029, 8);
  });

  it("connect_nodes refuses cycles with the engine's message", async () => {
    const r = await harness().call("connect_nodes", { from_node: "cash", to_node: "growth", to_input: "rate" });
    expect((r.result as { error: string }).error).toBe("Circular dependency detected. Signup growth → Conversion → Customers → Subscription revenue → Cash → Signup growth");
  });

  it("explain_metric traces MRR through the graph", async () => {
    const r = await harness().call("explain_metric", { metric: "mrr", period: 3 });
    expect(r.result).toMatchObject({ value: "$7,606", formula: "subscription revenue per month" });
    expect((r.result as { causal_chain: { node: string }[] }).causal_chain.map((c) => c.node)).toContain("Signup growth");
  });

  it("run_sensitivity_analysis ranks drivers", async () => {
    const r = await harness().call("run_sensitivity_analysis", { metric: "mrr" });
    expect((r.result as { ranking: { assumption: string }[] }).ranking[0]!.assumption).toBe("Signup growth");
  });

  it("run_monte_carlo explains when nothing is uncertain, and runs when something is", async () => {
    const none = await harness().call("run_monte_carlo", { runs: 100 });
    expect((none.result as { error: string }).error).toMatch(/No assumption has an uncertainty range/);
    const m = acceptanceModel();
    m.parameters!.find((p) => p.id === "p_growth")!.distribution = { type: "triangular", min: 0.1, mode: 0.2, max: 0.3 };
    const r = await harness(parseModel(m)).call("run_monte_carlo", { runs: 100 });
    expect(r.result).toMatchObject({ runs: 100, uncertain_assumptions: ["Signup growth"] });
  });

  it("find_bottleneck reports broken guardrails with causes", async () => {
    const m = acceptanceModel();
    m.guardrails = [{ id: "g", label: "Runway > 30 months", metric: "runwayMonths", operator: ">", threshold: 30 }];
    const r = await harness(parseModel(m)).call("find_bottleneck");
    expect((r.result as { guardrails: { cause: string }[] }).guardrails[0]!.cause).toMatch(/^Costs of/);
  });

  it("an agent run executes tools rather than answering conversationally (\"Increase pricing by 20%\")", async () => {
    const h = harness();
    const provider = new ScriptedProvider([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "update_assumption", arguments: { parameter_id: "Price", change_percent: 0.2 } }] },
      { role: "assistant", content: "", toolCalls: [{ id: "2", name: "run_simulation", arguments: {} }] },
      (req) => {
        const last = JSON.parse(req.messages[req.messages.length - 1]!.content) as { mrr: string };
        return `Done. MRR in 2028-12 is now ${last.mrr}.`;
      },
    ]);
    const r = await runAgent({ provider, tools: h.tools, messages: [{ role: "user", content: "Increase pricing by 20%." }] });
    expect(r.final).toBe("Done. MRR in 2028-12 is now $830.32K.");
    expect(h.model.parameters.find((p) => p.id === "p_price")!.value).toBe(46.8);
  });
});
