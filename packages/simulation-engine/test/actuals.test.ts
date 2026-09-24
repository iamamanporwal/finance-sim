import { acceptanceModel, parseModel } from "@fin/model-schema";
import { describe, expect, it } from "vitest";
import { actualsVsForecast, anchorFromActuals, parseActualsCsv, simulate } from "../src";

describe("actuals vs forecast", () => {
  const model = parseModel({
    ...acceptanceModel(),
    actuals: [
      { period: "2026-11", values: { mrr: 1000, customers: 30, cash: 520000 } },
      { period: "2026-12", values: { mrr: 1200, customers: 36, cash: 510000 } },
      { period: "2027-02", values: { customers: 100 } },
    ],
  });
  const result = simulate(model);

  it("lists actual months before the forecast, then forecast months with variance", () => {
    const rows = actualsVsForecast(model, result);
    expect(rows.slice(0, 3).map((r) => [r.period, r.kind])).toEqual([["2026-11", "actual"], ["2026-12", "actual"], ["2027-01", "forecast"]]);
    expect(rows.length).toBe(2 + 24);
    const feb = rows.find((r) => r.period === "2027-02")!;
    const forecastCustomers = result.timeline[1]!.customers.closing;
    expect(feb.forecast.customers).toBe(forecastCustomers);
    expect(feb.variance.customers).toBeCloseTo((100 - forecastCustomers) / forecastCustomers, 12);
    expect(rows.find((r) => r.period === "2027-03")!.variance).toEqual({});
  });

  it("anchors the forecast on the latest actuals", () => {
    expect(anchorFromActuals(model)).toEqual({ lastActual: "2027-02", startDate: "2027-03", customers: 100, cash: 510000 });
    expect(anchorFromActuals({ actuals: [] })).toBeNull();
  });

  it("parses pasted CSV or spreadsheet rows", () => {
    const { rows, errors } = parseActualsCsv('Month,MRR,Customers,Cash,Notes\nJan 2026,"$12,400",310,"$1,200,000",x\n2026-02,13100,322,(5000)\nfoo,1,2,3');
    expect(rows).toEqual([
      { period: "2026-01", values: { mrr: 12400, customers: 310, cash: 1200000 } },
      { period: "2026-02", values: { mrr: 13100, customers: 322, cash: -5000 } },
    ]);
    expect(errors).toEqual(['Column "Notes" is not recognized and was ignored.', 'Row 4: "foo" is not a month (use YYYY-MM).']);
    expect(parseActualsCsv("period\tmrr\n03/2026\t500").rows).toEqual([{ period: "2026-03", values: { mrr: 500 } }]);
  });

  it("stage is context only: it never changes the numbers", () => {
    const a = simulate(parseModel({ ...acceptanceModel(), metadata: { stage: "idea" } }));
    const b = simulate(parseModel({ ...acceptanceModel(), metadata: { stage: "scale" } }));
    expect(a.timeline).toEqual(b.timeline);
  });
});
