import { validateModel } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/model-ops";
import { LIBRARY_GROUPS, NODE_PRESETS, searchPresets } from "../src/lib/presets";

describe("node library", () => {
  it("contains the plan's basic nodes in each group", () => {
    const byGroup = (g: string) => NODE_PRESETS.filter((p) => p.group === g).map((p) => p.label);
    expect(byGroup("Customers")).toEqual(["Acquisition", "Conversion", "Customers", "Churn", "Upgrade", "Downgrade", "Split"]);
    expect(byGroup("Revenue")).toEqual(["Price", "Subscription", "Usage", "Top-up"]);
    expect(byGroup("Costs")).toEqual(["Fixed Cost", "Variable Cost", "Percentage Cost", "Step Cost"]);
    expect(byGroup("Resources")).toEqual(["Cash", "Pool", "Flow", "Burn", "Capacity"]);
    expect(byGroup("Logic")).toEqual(["Condition", "Trigger", "Formula"]);
    for (const g of LIBRARY_GROUPS) expect(byGroup(g).length).toBeGreaterThan(0);
  });
  it('search "churn" finds Churn first', () => {
    expect(searchPresets("churn")[0]!.label).toBe("Churn");
    expect(searchPresets("CHURN")[0]!.label).toBe("Churn");
  });
  it("search matches keywords", () => {
    expect(searchPresets("stripe").map((p) => p.label)).toContain("Percentage Cost");
    expect(searchPresets("mrr").map((p) => p.label)).toContain("Subscription");
    expect(searchPresets("zzz")).toEqual([]);
  });
  it("every preset produces a schema-valid node with valid assumptions", () => {
    for (const p of NODE_PRESETS) {
      const { model } = ops.addNode(ops.createBlankModel(), p, { x: 0, y: 0 });
      const errors = validateModel(model).issues.filter((i) => i.severity === "error" && i.code !== "missing-input");
      expect(errors, p.id).toEqual([]);
    }
  });
});
