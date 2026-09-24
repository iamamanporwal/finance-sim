import { acceptanceModel, parseModel } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import { explainWhy, simulate, type WhyStep } from "../src";

const model = parseModel(acceptanceModel());
const result = simulate(model);

const find = (s: WhyStep, label: string): WhyStep | undefined => (s.label === label ? s : s.children.map((c) => find(c, label)).find(Boolean));

describe("explainWhy", () => {
  it("traces MRR to the assumptions that drive it, using engine values", () => {
    const e = explainWhy(model, result, { metric: "mrr" });
    const last = result.timeline[23]!;
    expect(e.periodLabel).toBe("2028-12");
    expect(e.root.value).toBe(last.metrics.mrr);
    expect(e.chain).toEqual(["MRR", "Subscription revenue", "Customers", "Conversion", "Signup growth", "Signups"]);

    const revenue = find(e.root, "Subscription revenue")!;
    expect(revenue.value).toBe(last.nodes.revenue!.out);
    expect(revenue.formula).toMatch(/^quantity × price = [\d,.]+ × \$39 = \$\d/);

    const customers = find(e.root, "Customers")!;
    expect(customers.value).toBe(last.customers.closing);
    expect(customers.formula).toContain("(5% of opening)");

    const growth = find(e.root, "Signup growth")!;
    expect(growth.formula).toContain("(1 + 20%)^23");
    // Assumptions are leaves with their source.
    const price = find(e.root, "Price")!.children[0]!;
    expect(price).toMatchObject({ kind: "assumption", label: "Price", value: 39, source: "user", parameterId: "p_price" });
    expect(e.sentences[0]).toBe("MRR is $691.9K in 2028-12.");
    expect(e.facts.some((f) => f.label === "Monthly churn" && f.value === 0.05)).toBe(true);
  });

  it("uses the scenario's assumption values", () => {
    const slow = simulate(model, { scenarioId: "slow" });
    const e = explainWhy(model, slow, { metric: "customers" });
    expect(find(e.root, "Signup growth")!.children.find((c) => c.kind === "assumption")!.value).toBe(0.1);
    expect(e.scenarioId).toBe("slow");
  });

  it("explains a node, stops at stock opening balances and marks repeats", () => {
    const e = explainWhy(model, result, { nodeId: "cash" }, { period: 2 });
    expect(e.root.formula).toMatch(/^opening \+ inflow − outflow = /);
    const cogs = find(e.root, "COGS")!;
    expect(cogs.formula).toMatch(/volume × cost per unit = [\d,.]+ × \$8 =/);
    // Customers feeds both revenue and COGS: explained once, then marked as repeated.
    const repeats: WhyStep[] = [];
    const walk = (s: WhyStep) => {
      if (s.label === "Customers") repeats.push(s);
      s.children.forEach(walk);
    };
    walk(e.root);
    expect(repeats.length).toBe(2);
    expect(repeats.filter((r) => r.repeated).length).toBe(1);
  });

  it("gross margin shows the formula with this period's numbers", () => {
    const e = explainWhy(model, result, { metric: "grossMargin" }, { period: 1 });
    expect(e.root.formula).toMatch(/^\(revenue − COGS\) ÷ revenue = \(\$[\d,]+ − \$[\d,]+\) ÷ \$[\d,]+$/);
  });
});
