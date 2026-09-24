import { acceptanceModel, parseModel } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import { CircularDependencyError, DependencyGraph, simulate, SimulationBlockedError, Simulator, validateForSimulation } from "../src";
import { makeModel } from "./helpers";

const cyclicModel = () =>
  makeModel({
    nodes: [
      { id: "a", type: "FLOW", label: "A" },
      { id: "b", type: "FLOW", label: "B" },
      { id: "c", type: "FLOW", label: "C" },
    ],
    connections: [
      ["a", "b", "amount"],
      ["b", "c", "amount"],
      ["c", "a", "amount"],
    ],
  });

describe("dependency graph", () => {
  const graph = DependencyGraph.fromModel(parseModel(acceptanceModel()));

  it("orders nodes so every dependency runs first", () => {
    const order = graph.topologicalOrder();
    const before = (a: string, b: string) => expect(order.indexOf(a), `${a} before ${b}`).toBeLessThan(order.indexOf(b));
    before("signups", "growth");
    before("growth", "conversion");
    before("conversion", "customers");
    before("churn", "customers");
    before("customers", "revenue");
    before("price", "revenue");
    before("customers", "cogs");
    before("revenue", "cash");
    before("cogs", "cash");
    before("fixed", "cash");
    expect(order).toHaveLength(10);
  });

  it("is deterministic", () => {
    expect(DependencyGraph.fromModel(parseModel(acceptanceModel())).topologicalOrder()).toEqual(graph.topologicalOrder());
  });

  it("finds everything downstream of an assumption change", () => {
    expect([...graph.downstreamOf(["growth"])].sort()).toEqual(["cash", "cogs", "conversion", "customers", "growth", "revenue"]);
    expect([...graph.downstreamOf(["fixed"])].sort()).toEqual(["cash", "fixed"]);
  });

  it("finds everything upstream of a metric (for Why?)", () => {
    expect([...graph.upstreamOf(["revenue"])].sort()).toEqual(["churn", "conversion", "customers", "growth", "price", "revenue", "signups"]);
  });
});

describe("circular dependencies", () => {
  it("detects A → B → C → A", () => {
    const graph = DependencyGraph.fromModel(parseModel(cyclicModel()));
    expect(graph.findCycle()).toEqual(["a", "b", "c", "a"]);
    expect(() => graph.topologicalOrder()).toThrow(CircularDependencyError);
    expect(() => graph.topologicalOrder()).toThrow("Circular dependency detected. A → B → C → A");
  });

  it("blocks the simulation with a readable issue", () => {
    const v = validateForSimulation(cyclicModel());
    expect(v.valid).toBe(false);
    expect(v.issues.find((i) => i.code === "circular-dependency")?.message).toBe("Circular dependency detected. A → B → C → A");
    expect(() => simulate(cyclicModel())).toThrow(SimulationBlockedError);
    expect(() => simulate(cyclicModel())).toThrow(/Simulation blocked — 1 issue found/);
  });

  it("detects a same-period loop through a stock's closing value", () => {
    const m = acceptanceModel();
    m.nodes.push({ id: "loop", type: "FORMULA", label: "Referral", config: { expression: "customers * 0.01" } });
    m.connections!.push(
      { id: "l1", source: "customers", target: "loop", targetPort: "customers" },
      { id: "l2", source: "loop", target: "customers", targetPort: "new" },
    );
    expect(validateForSimulation(m).issues.find((i) => i.code === "circular-dependency")?.message).toBe(
      "Circular dependency detected. Customers → Referral → Customers",
    );
  });

  it("allows feedback loops through a stock's opening balance (lagged edge)", () => {
    // Referral: new customers this period = 1% of customers at the START of the period.
    const m = acceptanceModel();
    m.nodes.push({ id: "loop", type: "FORMULA", label: "Referral", config: { expression: "customers * 0.01" } });
    m.connections!.push(
      { id: "l1", source: "customers", sourcePort: "opening", target: "loop", targetPort: "customers" },
      { id: "l2", source: "loop", target: "customers", targetPort: "new" },
    );
    const r = simulate(m);
    // Month 2: opening 56 → 0.56 referrals on top of 67.2 converted signups.
    expect(r.timeline[1]!.customers.new).toBeCloseTo(67.2 + 0.56, 10);
  });

  it("supports cash-dependent decisions (hire only while opening cash > threshold)", () => {
    const m = makeModel(
      {
        nodes: [
          { id: "cash", type: "CASH", label: "Cash", parameters: { initial: "c0" } },
          { id: "rule", type: "CONDITION", label: "Can afford hire", parameters: { threshold: "t", then: "salary", else: "zero" } },
          { id: "hire", type: "COST", label: "Engineer", config: { costType: "fixed", category: "payroll" } },
        ],
        connections: [
          ["cash", "rule", "value", "opening"],
          ["rule", "hire", "amount"],
          ["hire", "cash", "outflow"],
        ],
        params: [{ id: "c0", value: 100 }, { id: "t", value: 50 }, { id: "salary", value: 30 }, { id: "zero", value: 0 }],
      },
      { horizon: 4 },
    );
    const r = simulate(m);
    expect(r.timeline.map((p) => p.cash.closing)).toEqual([70, 40, 40, 40]);
  });
});

describe("incremental recalculation", () => {
  it("changing growth recalculates only downstream nodes (not fixed costs, price or churn)", () => {
    const sim = new Simulator(acceptanceModel());
    sim.run();
    sim.setParameter("p_growth", 0.1);
    expect([...sim.dirtyNodes].sort()).toEqual(["cash", "cogs", "conversion", "customers", "growth", "revenue"]);
    const { result, recomputed } = sim.recalculate();
    expect(recomputed).toEqual(["growth", "conversion", "customers", "revenue", "cogs", "cash"]);
    for (const untouched of ["signups", "churn", "price", "fixed"]) expect(sim.evaluationCounts.get(untouched)).toBe(1);
    expect(sim.evaluationCounts.get("growth")).toBe(2);
    // Incremental result is identical to a fresh full run.
    expect(result.timeline).toEqual(simulate(acceptanceModel(), { parameterOverrides: { p_growth: 0.1 } }).timeline);
  });

  it("changing an unrelated cost recalculates only that cost and cash", () => {
    const sim = new Simulator(acceptanceModel());
    sim.run();
    const { result, recomputed } = sim.setParameter("p_fixed", 25000).recalculate();
    expect(recomputed).toEqual(["fixed", "cash"]);
    expect(result.timeline[0]!.cash.closing).toBe(500000 + 2184 - 448 - 25000);
  });

  it("accumulates several changes before recalculating", () => {
    const sim = new Simulator(acceptanceModel());
    sim.run();
    sim.setParameter("p_price", 49).setParameter("p_churn", 0.03);
    const { result, recomputed } = sim.recalculate();
    expect([...recomputed].sort()).toEqual(["cash", "churn", "cogs", "customers", "price", "revenue"]);
    expect(result.timeline).toEqual(simulate(acceptanceModel(), { parameterOverrides: { p_price: 49, p_churn: 0.03 } }).timeline);
  });

  it("recalculates nothing when nothing changed", () => {
    const sim = new Simulator(acceptanceModel());
    const first = sim.run();
    const { result, recomputed } = sim.recalculate();
    expect(recomputed).toEqual([]);
    expect(result).toEqual(first);
  });

  it("rejects invalid values and leaves the simulation unchanged", () => {
    const sim = new Simulator(acceptanceModel());
    const before = sim.run();
    expect(() => sim.setParameter("p_conversion", 1.5)).toThrow("Conversion: Conversion rate must be between 0% and 100%.");
    expect(() => sim.setParameter("p_growth", Number.NaN)).toThrow(SimulationBlockedError);
    expect(() => sim.setParameter("ghost", 1)).toThrow(/Unknown parameter/);
    expect(sim.dirtyNodes.size).toBe(0);
    expect(sim.recalculate().result).toEqual(before);
  });

  it("layers what-if edits on top of a scenario", () => {
    const sim = new Simulator(acceptanceModel(), { scenarioId: "slow" });
    sim.run();
    const { result } = sim.setParameter("p_price", 49).recalculate();
    expect(result.timeline[1]!.nodes.growth!.out).toBe(880); // scenario growth still applies
    expect(result.timeline[0]!.nodes.price!.out).toBe(49);
  });
});

describe("pre-simulation validation", () => {
  it("warns when a cost is not connected to cash", () => {
    const m = acceptanceModel();
    m.connections = m.connections!.filter((c) => c.id !== "c10");
    const v = validateForSimulation(m);
    expect(v.valid).toBe(true);
    expect(v.issues.find((i) => i.code === "not-in-cash")?.message).toBe("Fixed costs is not connected to Cash, so it does not affect the cash balance.");
  });
  it("warns about disconnected nodes", () => {
    const m = acceptanceModel();
    m.parameters!.push({ id: "p_x", name: "X", value: 1 });
    m.nodes.push({ id: "orphan", type: "INPUT", label: "Orphan", parameters: { value: "p_x" } });
    expect(validateForSimulation(m).issues.map((i) => i.code)).toContain("disconnected-node");
  });
  it("blocks simulation when a required input is missing", () => {
    const m = acceptanceModel();
    m.connections = m.connections!.filter((c) => c.id !== "c6");
    expect(() => simulate(m)).toThrow('Simulation blocked — 1 issue found:\n- Subscription revenue: "Price" is required. Connect a node or enter a value.');
  });
});
