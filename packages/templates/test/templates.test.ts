import { validateModel } from "@fin/model-schema";
import { simulate, validateForSimulation } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { instantiateTemplate, recommendTemplates, TEMPLATES } from "../src";

describe("template library", () => {
  it("has the plan's templates", () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(["SaaS subscription", "AI SaaS", "Usage-based SaaS", "AI SaaS + subscription + credits", "Marketplace", "API business", "HERE"]);
  });

  it.each(TEMPLATES.map((t) => [t.id]))("%s is valid, simulates, and labels every assumption as a template value", (id) => {
    const m = instantiateTemplate(id, `m_${id.replace(/-/g, "_")}`);
    const v = validateForSimulation(m);
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(v.issues.filter((i) => i.code === "disconnected-node" || i.code === "unused-parameter")).toEqual([]);
    expect(m.parameters.every((p) => p.source === "template")).toBe(true);
    const r = simulate(m);
    const last = r.timeline[r.timeline.length - 1]!;
    expect(last.revenue.total).toBeGreaterThan(0);
    expect(last.customers.closing).toBeGreaterThan(0);
    for (const p of r.timeline) expect(Object.values(p.metrics).every((x) => x === null || Number.isFinite(x))).toBe(true);
    expect(m.metadata.templateId).toBe(id);
  });

  it("recommends templates by stage and revenue model", () => {
    expect(recommendTemplates("seed", "credits")[0]!.id).toBe("credit-saas");
    expect(recommendTemplates("idea", "subscription")[0]!.id).toBe("ai-saas");
  });
});

describe("HERE template", () => {
  const model = instantiateTemplate("here", "m_here");
  const r = simulate(model);
  const at = (i: number) => r.timeline[i - 1]!;

  it("has Signal, Prime, Studio, World and Dedicated", () => {
    expect(model.nodes.filter((n) => ["POOL", "CUSTOMERS"].includes(n.type)).map((n) => n.label)).toEqual(["Signal (free)", "Prime", "Studio", "World", "Dedicated"]);
    expect(model.nodes.find((n) => n.id === "planSplit")!.type).toBe("SPLIT");
  });

  it("uses only generic node types", () => {
    const types = new Set(model.nodes.map((n) => n.type));
    expect([...types].sort()).toEqual(["CASH", "CONVERSION", "COST", "CREDIT_WALLET", "CUSTOMERS", "FLOW", "GROWTH", "INPUT", "POOL", "REVENUE", "REVENUE_RECOGNITION", "SPLIT"]);
  });

  it("produces every HERE metric from the engine", () => {
    const p = at(12);
    for (const k of ["mrr", "cogs", "grossMargin", "contribution", "nrr", "cash", "breakageRate", "burnDepth", "rationingRate", "apg", "wscb", "deferredRevenue"]) {
      expect(p.metrics[k], k).not.toBeNull();
    }
    expect(at(24).metrics.nrrAnnual).not.toBeNull();
    // Upgrades into higher-priced plans lift retained revenue.
    expect(p.metrics.nrr!).toBeGreaterThan(0.9);
    expect(p.revenue.topups).toBeGreaterThan(0);
    // Cash from top-ups is collected before it is recognized.
    expect(p.metrics.deferredRevenue!).toBeGreaterThan(0);
    // One guardian per 120 accounts.
    expect(p.nodes.guardians!.units).toBe(Math.ceil(p.customers.closing / 120));
    expect(p.metrics.apg!).toBeCloseTo(p.customers.closing / p.nodes.guardians!.units!, 9);
  });

  it("plan mix and guardrails are configurable, and unconfirmed metrics are flagged", () => {
    expect(r.guardrails.map((g) => g.guardrailId)).toEqual(["g_margin", "g_runway", "g_breakage", "g_apg", "g_rationing", "g_cash"]);
    const warnings = validateModel(model).issues.filter((i) => i.code === "unconfirmed-metric").map((i) => i.message);
    expect(warnings).toEqual([
      'Custom metric "APG" uses a placeholder definition that has not been confirmed.',
      'Custom metric "WSCB" uses a placeholder definition that has not been confirmed.',
    ]);
  });
});

describe("template layout", () => {
  it.each(TEMPLATES.map((t) => [t.id]))("%s: nodes never overlap and flow left to right", async (id) => {
    const { estimateNodeHeight, NODE_WIDTH } = await import("@fin/model-schema");
    const m = instantiateTemplate(id, "m_layout");
    const boxes = m.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, h: estimateNodeHeight(n) }));
    for (const a of boxes) for (const b of boxes) {
      if (a.id >= b.id) continue;
      const overlap = a.x < b.x + NODE_WIDTH && b.x < a.x + NODE_WIDTH && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
    const x = new Map(m.nodes.map((n) => [n.id, n.position.x]));
    const forward = m.connections.filter((c) => c.sourcePort !== "opening").every((c) => x.get(c.source)! < x.get(c.target)!);
    expect(forward).toBe(true);
  });
});
