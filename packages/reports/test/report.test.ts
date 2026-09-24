import { acceptanceModel, parseModel, ReportSchema } from "@fin/model-schema";
import { runMonteCarlo } from "@fin/monte-carlo";
import { compareScenarios, runSensitivity, simulate } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { generateReport, reportToMarkdown } from "../src";

describe("report generation", () => {
  const model = parseModel(acceptanceModel());
  const result = simulate(model);

  it("contains every required section and matches the schema", () => {
    const r = generateReport({ model, result, generatedAt: "2026-01-01T00:00:00Z" });
    expect(() => ReportSchema.parse(r)).not.toThrow();
    expect(r.sections.map((s) => s.kind)).toEqual([
      "executive_summary", "current_state", "assumptions", "revenue", "costs", "profitability", "cash", "runway", "customers", "risks", "sensitivity", "scenarios", "monte_carlo", "recommendations",
    ]);
  });

  it("quotes engine numbers in the executive summary", () => {
    const r = generateReport({ model, result });
    const body = r.sections[0]!.body;
    expect(body).toContain("24 monthly periods (2027-01 to 2028-12)");
    expect(body).toContain("Operating profit turns positive in 2027-07 (period 7).");
    expect(body).toContain("Gross margin stabilizes around 79%.");
    expect(body).toMatch(/Cash stays positive throughout, ending at \$3\.2M \(lowest \$427\.79K in 2027-06\)\./);
  });

  it("includes sensitivity, scenarios and Monte Carlo when provided", () => {
    const m = acceptanceModel();
    m.parameters!.find((p) => p.id === "p_growth")!.distribution = { type: "triangular", min: 0.1, mode: 0.2, max: 0.3 };
    const pm = parseModel(m);
    const r = generateReport({
      model: pm,
      result: simulate(pm),
      sensitivity: runSensitivity(pm, { metric: "mrr" }),
      scenarios: compareScenarios(pm, [null, "slow"]),
      monteCarlo: runMonteCarlo(pm, { runs: 100, seed: 1 }),
    });
    const byKind = Object.fromEntries(r.sections.map((s) => [s.kind, s]));
    expect(byKind.executive_summary!.body).toContain("The largest driver of MRR in 2028-12 is Signup growth.");
    expect(byKind.sensitivity!.body).toMatch(/come from Signup growth/);
    expect((byKind.scenarios!.data as { table: { columns: string[] } }).table.columns).toEqual(["Metric", "Base model", "Slow growth"]);
    expect(byKind.monte_carlo!.body).toMatch(/^100 runs \(seed 1\) sampling Signup growth/);
    expect(byKind.recommendations!.body).toContain("Signup growth has the largest effect on MRR");
  });

  it("reports risks from guardrails with engine explanations", () => {
    const m = acceptanceModel();
    m.guardrails = [{ id: "r", label: "Runway > 30 months", metric: "runwayMonths", operator: ">", threshold: 30 }];
    const pm = parseModel(m);
    const r = generateReport({ model: pm, result: simulate(pm) });
    expect(r.sections.find((s) => s.kind === "risks")!.body).toMatch(/^- Runway > 30 months: not met in \d+ period\(s\), first in 2027-0\d\. Costs of/);
  });

  it("renders markdown with tables", () => {
    const md = reportToMarkdown(generateReport({ model, result }));
    expect(md).toMatch(/^# Acceptance model — simulation report/);
    expect(md).toContain("| Assumption | Value | Source | Confidence | Uncertainty |");
    expect(md).toContain("| Signup growth | 20% | User | — | none |");
    expect(md).not.toMatch(/NaN|undefined|Infinity/);
  });
});
