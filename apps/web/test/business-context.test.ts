import { acceptanceModel, parseModel } from "@fin/model-schema";
import { simulate } from "@fin/simulation-engine";
import { instantiateTemplate } from "@fin/templates";
import { describe, expect, it } from "vitest";
import { applyStartingPoint, currentStateGaps, focusMetrics, GOALS, healthDimensions, startingPointFromActuals } from "../src/lib/business-context";

const model = parseModel(acceptanceModel());
const result = simulate(model);

describe("business context", () => {
  it("answers the founder's questions from engine output", () => {
    const answers = Object.fromEntries(GOALS.map((g) => [g.id, g.answer(result, "USD")]));
    expect(answers["cash-out"]).toMatch(/^Not within the forecast: cash stays positive through 2028-12 \(lowest \$[\d.,K]+ in 2027-0\d\)\.$/);
    expect(answers["break-even"]).toBe("In 2027-07 (period 7), when operating profit turns positive.");
  });

  it("stage and goals choose what to show first", () => {
    expect(focusMetrics({ ...model, metadata: { stage: "pre-seed", goals: ["pricing"] } })).toEqual(["cash", "burn", "runwayMonths", "customers", "mrr", "grossMargin", "contributionMargin"]);
  });

  it("health is reported per dimension with its rule", () => {
    const h = healthDimensions(result);
    expect(h.map((d) => d.dimension)).toEqual(["Cash", "Growth", "Margin", "Retention"]);
    expect(h.every((d) => d.rule.length > 0)).toBe(true);
  });

  it("applies a starting point to single Customers/Cash nodes and explains what it skipped", () => {
    const r = applyStartingPoint(model, { customers: 420, cash: 1_400_000, startDate: "2027-03", label: "your current state (2027-02)" });
    expect(r.changes).toEqual([
      { what: "Starting customers", from: "0", to: "420" },
      { what: "Starting cash", from: "$500K", to: "$1.4M" },
      { what: "Forecast start", from: "2027-01", to: "2027-03" },
    ]);
    const p = r.model.parameters.find((x) => x.id === "p_cash")!;
    expect(p).toMatchObject({ value: 1_400_000, source: "imported" });
    const here = applyStartingPoint(instantiateTemplate("here", "m"), { customers: 10, label: "x" });
    expect(here.skipped[0]).toMatch(/4 Customers nodes/);
  });

  it("flags gaps between today and the forecast start", () => {
    const m = { ...model, currentState: { asOf: "2026-12", customers: 400, cash: 500000, source: "user" as const } };
    expect(currentStateGaps(m, result)).toEqual(["The forecast starts with 0 customers, but you have 400 today."]);
    const fixed = startingPointFromActuals({ ...m, actuals: [{ period: "2026-12", values: { customers: 400 } }] });
    expect(simulate(fixed.model).timeline[0]!.customers.opening).toBe(400);
  });
});
