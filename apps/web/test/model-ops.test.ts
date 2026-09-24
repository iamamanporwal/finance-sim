import { validateModel } from "@fin/model-schema";
import { simulate, validateForSimulation } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/model-ops";
import { findPreset } from "../src/lib/presets";

const preset = (id: string) => findPreset(id)!;

/** Adds a node from a preset and returns [model, nodeId]. */
function add(model: ReturnType<typeof ops.createBlankModel>, presetId: string, x = 0) {
  const r = ops.addNode(model, preset(presetId), { x, y: 0 });
  return [r.model, r.nodeId] as const;
}

describe("Phase 6 definition of done: build Input → Growth → Conversion → Customers → Price → Revenue and run it", () => {
  it("creates a valid, runnable model purely through editor operations", () => {
    let m = ops.createBlankModel("Visual model", "m_test");
    let input: string, growth: string, conv: string, cust: string, price: string, rev: string, cash: string;
    [m, input] = add(m, "input");
    [m, growth] = add(m, "growth", 260);
    [m, conv] = add(m, "conversion", 520);
    [m, cust] = add(m, "customers", 780);
    [m, price] = add(m, "price", 780);
    [m, rev] = add(m, "subscription", 1040);
    [m, cash] = add(m, "cash", 1300);
    m = ops.connect(m, { source: input, sourcePort: "out", target: growth, targetPort: "base" });
    m = ops.connect(m, { source: growth, sourcePort: "out", target: conv, targetPort: "input" });
    m = ops.connect(m, { source: conv, sourcePort: "out", target: cust, targetPort: "new" });
    m = ops.connect(m, { source: cust, sourcePort: "out", target: rev, targetPort: "quantity" });
    m = ops.connect(m, { source: price, sourcePort: "out", target: rev, targetPort: "price" });
    m = ops.connect(m, { source: rev, sourcePort: "out", target: cash, targetPort: "inflow" });

    const v = validateForSimulation(m);
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    const r = simulate(m);
    expect(r.timeline).toHaveLength(24);
    // Preset defaults: 1000 users, 10% growth, 5% conversion, $39 → month 1 revenue = 1000 × 5% × 39
    expect(r.timeline[0]!.revenue.total).toBe(1950);
    expect(r.timeline[1]!.nodes[growth]!.out).toBe(1100);
  });
});

describe("addNode", () => {
  it("creates the preset's assumptions and binds them", () => {
    const [m, id] = add(ops.createBlankModel(), "churn");
    const node = m.nodes.find((n) => n.id === id)!;
    const param = m.parameters.find((p) => p.id === node.parameters.rate)!;
    expect(param).toMatchObject({ value: 0.05, unit: "percent", source: "user" });
    expect(validateModel(m).valid).toBe(true);
  });
  it("gives duplicate labels a number", () => {
    let m = ops.createBlankModel();
    [m] = add(m, "churn");
    [m] = add(m, "churn");
    expect(m.nodes.map((n) => n.label)).toEqual(["Churn", "Churn 2"]);
  });
  it("uses the model currency for money units", () => {
    let m = ops.updateSettings(ops.createBlankModel(), { currency: "INR" });
    [m] = add(m, "price");
    expect(m.parameters.find((p) => p.name.endsWith("Price"))!.unit).toBe("INR/customers");
  });
});

describe("connect", () => {
  it("unbinds a slot's direct value once it is connected", () => {
    let m = ops.createBlankModel();
    let rate: string, conv: string;
    [m, rate] = add(m, "input");
    [m, conv] = add(m, "conversion");
    const before = m.nodes.find((n) => n.id === conv)!.parameters.rate;
    expect(before).toBeDefined();
    m = ops.connect(m, { source: rate, sourcePort: "out", target: conv, targetPort: "rate" });
    expect(m.nodes.find((n) => n.id === conv)!.parameters.rate).toBeUndefined();
    expect(m.parameters.some((p) => p.id === before)).toBe(false);
  });
  it("replaces an existing connection into a single-input slot", () => {
    let m = ops.createBlankModel();
    let a: string, b: string, rev: string;
    [m, a] = add(m, "price");
    [m, b] = add(m, "price");
    [m, rev] = add(m, "subscription");
    m = ops.connect(m, { source: a, sourcePort: "out", target: rev, targetPort: "price" });
    m = ops.connect(m, { source: b, sourcePort: "out", target: rev, targetPort: "price" });
    expect(m.connections.filter((c) => c.target === rev)).toHaveLength(1);
    expect(m.connections[0]!.source).toBe(b);
  });
  it("rejects cycles with the circular dependency message", () => {
    let m = ops.createBlankModel();
    let a: string, b: string;
    [m, a] = add(m, "flow");
    [m, b] = add(m, "flow");
    m = ops.connect(m, { source: a, sourcePort: "out", target: b, targetPort: "amount" });
    const check = ops.canConnect(m, { source: b, sourcePort: "out", target: a, targetPort: "amount" });
    expect(check).toEqual({ ok: false, reason: "Circular dependency detected. Flow → Flow 2 → Flow" });
  });
  it("rejects self, unknown ports and parameter-only slots", () => {
    let m = ops.createBlankModel();
    let a: string, c: string;
    [m, a] = add(m, "input");
    [m, c] = add(m, "customers");
    expect(ops.canConnect(m, { source: a, sourcePort: "out", target: a, targetPort: "value" }).ok).toBe(false);
    expect(ops.canConnect(m, { source: a, sourcePort: "nope", target: c, targetPort: "new" }).ok).toBe(false);
    expect(ops.canConnect(m, { source: a, sourcePort: "out", target: c, targetPort: "initial" })).toMatchObject({ ok: false });
  });
  it("allows feedback through a lagged opening port", () => {
    let m = ops.createBlankModel();
    let cust: string, f: string;
    [m, cust] = add(m, "customers");
    [m, f] = add(m, "flow");
    m = ops.connect(m, { source: cust, sourcePort: "opening", target: f, targetPort: "amount" });
    expect(ops.canConnect(m, { source: f, sourcePort: "out", target: cust, targetPort: "new" }).ok).toBe(true);
  });
});

describe("removeElements", () => {
  it("removes nodes, their connections and their assumptions", () => {
    let m = ops.createBlankModel();
    let a: string, b: string;
    [m, a] = add(m, "input");
    [m, b] = add(m, "conversion");
    m = ops.connect(m, { source: a, sourcePort: "out", target: b, targetPort: "input" });
    m = ops.removeElements(m, [a]);
    expect(m.nodes.map((n) => n.id)).toEqual([b]);
    expect(m.connections).toEqual([]);
    expect(m.parameters).toHaveLength(1);
  });
  it("restores a direct value after a connection is removed only when needed", () => {
    let m = ops.createBlankModel();
    let r: string, conv: string;
    [m, r] = add(m, "input");
    [m, conv] = add(m, "conversion");
    m = ops.connect(m, { source: r, sourcePort: "out", target: conv, targetPort: "rate" });
    m = ops.removeElements(m, [], [m.connections[0]!.id]);
    // rate is a required rate slot → a fresh assumption (0) is created so the user can edit it
    expect(m.nodes.find((n) => n.id === conv)!.parameters.rate).toBeDefined();
  });
});

describe("copy / paste / duplicate", () => {
  it("clones nodes, assumptions and internal connections with new IDs", () => {
    let m = ops.createBlankModel();
    let a: string, b: string;
    [m, a] = add(m, "input");
    [m, b] = add(m, "conversion");
    m = ops.connect(m, { source: a, sourcePort: "out", target: b, targetPort: "input" });
    const { model, nodeIds } = ops.pasteFragment(m, ops.copyFragment(m, [a, b]));
    expect(model.nodes).toHaveLength(4);
    expect(model.connections).toHaveLength(2);
    expect(nodeIds).not.toContain(a);
    const copy = model.nodes.find((n) => n.id === nodeIds[1])!;
    expect(copy.label).toBe("Conversion 2");
    expect(copy.parameters.rate).not.toBe(m.nodes.find((n) => n.id === b)!.parameters.rate);
    expect(copy.position).toEqual({ x: 40, y: 40 });
    expect(validateModel(model).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("updateNode", () => {
  it("switching cost type swaps assumptions and drops invalid connections", () => {
    let m = ops.createBlankModel();
    let cust: string, cost: string;
    [m, cust] = add(m, "customers");
    [m, cost] = add(m, "variable-cost");
    m = ops.connect(m, { source: cust, sourcePort: "out", target: cost, targetPort: "volume" });
    const node = m.nodes.find((n) => n.id === cost)!;
    m = ops.updateNode(m, cost, { config: { ...(node.config as object), costType: "fixed" } });
    const updated = m.nodes.find((n) => n.id === cost)!;
    expect(Object.keys(updated.parameters)).toEqual(["amount"]);
    expect(m.connections).toEqual([]);
  });
  it("adding a split branch creates its share assumption", () => {
    let m = ops.createBlankModel();
    let s: string;
    [m, s] = add(m, "split");
    const node = m.nodes.find((n) => n.id === s)!;
    const branches = [...(node.config as { branches: { key: string; label: string }[] }).branches, { key: "planC", label: "Plan C" }];
    m = ops.updateNode(m, s, { config: { branches } });
    expect(Object.keys(m.nodes[0]!.parameters).sort()).toEqual(["weight.planA", "weight.planB", "weight.planC"]);
  });
  it("ignores invalid config", () => {
    let m = ops.createBlankModel();
    let s: string;
    [m, s] = add(m, "split");
    const next = ops.updateNode(m, s, { config: { branches: [] } });
    expect(next.nodes[0]!.config).toEqual(m.nodes[0]!.config);
  });
});

describe("bind / unbind", () => {
  it("creates an assumption for an unset optional slot and removes it again", () => {
    let m = ops.createBlankModel();
    let c: string;
    [m, c] = add(m, "customers");
    m = ops.bindNewParameter(m, c, "churnRate");
    const pid = m.nodes[0]!.parameters.churnRate!;
    expect(m.parameters.find((p) => p.id === pid)).toMatchObject({ value: 0, unit: "percent" });
    m = ops.unbindParameter(m, c, "churnRate");
    expect(m.nodes[0]!.parameters.churnRate).toBeUndefined();
    expect(m.parameters.some((p) => p.id === pid)).toBe(false);
  });
});
