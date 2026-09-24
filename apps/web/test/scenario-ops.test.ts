import { acceptanceModel, parseModel, type Model } from "@fin/model-schema";
import { simulate, validateForSimulation } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import * as so from "../src/lib/scenario-ops";
import { applyDefaultUncertainty, uncertaintyLevel } from "../src/lib/uncertainty";

const base = () => parseModel(acceptanceModel());

describe("scenarios (overrides only)", () => {
  it("setting a value in a scenario never modifies the base model", () => {
    let m = base();
    const { model, id } = so.addScenario(m, { name: "Pricing +20%" });
    m = so.setOverride(model, id, "p_price", 46.8);
    expect(m.parameters.find((p) => p.id === "p_price")!.value).toBe(39);
    expect(so.effectiveValue(m, id, "p_price")).toBe(46.8);
    expect(so.effectiveValue(m, null, "p_price")).toBe(39);
    const r = simulate(m, { scenarioId: id });
    expect(r.timeline[0]!.revenue.total).toBeCloseTo(56 * 46.8, 8);
  });
  it("child scenarios inherit, and report where an override comes from", () => {
    let m = base();
    const up = so.addScenario(m, { name: "Upside" });
    m = so.setOverride(up.model, up.id, "p_growth", 0.25);
    const child = so.addScenario(m, { name: "Upside + price", parentId: up.id });
    m = so.setOverride(child.model, child.id, "p_price", 49);
    expect(so.effectiveValue(m, child.id, "p_growth")).toBe(0.25);
    expect(so.overrideSource(m, child.id, "p_growth")!.name).toBe("Upside");
    expect(so.overrideSource(m, child.id, "p_price")!.name).toBe("Upside + price");
    expect(so.overrideSource(m, child.id, "p_churn")).toBeNull();
  });
  it("duplicates with copied overrides and a unique name", () => {
    const m0 = so.setOverride(base(), "slow", "p_price", 45);
    const { model, id } = so.duplicateScenario(m0, "slow");
    const copy = model.scenarios.find((s) => s.id === id)!;
    expect(copy.name).toBe("Slow growth copy");
    expect(copy.overrides).toEqual(model.scenarios.find((s) => s.id === "slow")!.overrides);
  });
  it("deleting a parent re-parents its children", () => {
    const child = so.addScenario(base(), { name: "Child", parentId: "slow" });
    const m = so.deleteScenario(child.model, "slow");
    expect(m.scenarios.find((s) => s.id === child.id)!.parentId).toBeUndefined();
    expect(validateForSimulation(m).valid).toBe(true);
  });
  it("clearOverride returns the assumption to its base value", () => {
    const m = so.clearOverride(base(), "slow", "p_growth");
    expect(so.effectiveValue(m, "slow", "p_growth")).toBe(0.2);
  });
  it("creates Base / Upside / Downside once, with sensible directions", () => {
    const m = so.createStandardScenarios({ ...base(), scenarios: [] });
    expect(m.scenarios.map((s) => s.kind)).toEqual(["base", "upside", "downside"]);
    const up = m.scenarios[1]!;
    const down = m.scenarios[2]!;
    expect(so.effectiveValue(m, up.id, "p_churn")).toBeCloseTo(0.04, 10);
    expect(so.effectiveValue(m, down.id, "p_churn")).toBeCloseTo(0.06, 10);
    expect(simulate(m, { scenarioId: up.id }).summary.cash!).toBeGreaterThan(simulate(m, { scenarioId: down.id }).summary.cash!);
    expect(so.createStandardScenarios(m).scenarios).toHaveLength(3);
  });
});

describe("guardrails", () => {
  it("adds guardrails with readable labels", () => {
    let m: Model = { ...base(), guardrails: [] };
    for (const s of so.GUARDRAIL_SUGGESTIONS) m = so.addGuardrail(m, s);
    expect(m.guardrails.map((g) => g.label)).toEqual(["Gross margin > 55%", "Runway > 6 months", "Churn rate < 8%", "CAC payback < 12 months", "Cash > $0"]);
    expect(validateForSimulation(m).valid).toBe(true);
  });
  it("keeps auto labels in sync, but not custom labels", () => {
    let m = so.addGuardrail({ ...base(), guardrails: [] }, { metric: "grossMargin", operator: ">", threshold: 0.55, severity: "warning" });
    const id = m.guardrails[0]!.id;
    m = so.updateGuardrail(m, id, { threshold: 0.6 });
    expect(m.guardrails[0]!.label).toBe("Gross margin > 60%");
    m = so.updateGuardrail(m, id, { label: "Healthy margin" });
    m = so.updateGuardrail(m, id, { threshold: 0.5 });
    expect(m.guardrails[0]!.label).toBe("Healthy margin");
    expect(so.removeGuardrail(m, id).guardrails).toEqual([]);
  });
});

describe("default uncertainty", () => {
  it("adds ±25% to rates, prices and unit costs but not starting balances", () => {
    const m = applyDefaultUncertainty(base());
    const level = (id: string) => uncertaintyLevel(m.parameters.find((p) => p.id === id)!);
    for (const id of ["p_growth", "p_conversion", "p_churn", "p_price", "p_cogs", "p_fixed"]) expect(level(id), id).toBe("medium");
    expect(level("p_cash")).toBe("none");
    expect(level("p_signups")).toBe("none");
    expect(validateForSimulation(m).valid).toBe(true);
  });
});
