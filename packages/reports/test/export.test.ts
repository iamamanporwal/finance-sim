import { acceptanceModel, parseModel } from "@fin/model-schema";
import { runMonteCarlo } from "@fin/monte-carlo";
import { compareScenarios, simulate } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { assumptionsCsv, csvCell, importModelJson, modelJson, monteCarloCsv, nodeValuesCsv, resultsJson, scenariosCsv, timelineCsv } from "../src";

const model = parseModel(acceptanceModel());
const result = simulate(model);

describe("exports", () => {
  it("escapes CSV and neutralises formula injection in text", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(NaN)).toBe("");
  });

  it("round-trips a model through JSON", () => {
    const { model: back, issues } = importModelJson(modelJson(model));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(back).toEqual(model);
    expect(importModelJson(JSON.stringify(model)).model).toEqual(model);
    expect(importModelJson("{nope").issues[0]!.code).toBe("invalid-json");
    expect(importModelJson(JSON.stringify({ ...model, nodes: "x" })).model).toBeNull();
  });

  it("timeline CSV has one row per period with raw engine values", () => {
    const lines = timelineCsv(model, result).trim().split("\r\n");
    expect(lines.length).toBe(25);
    const header = lines[0]!.split(",");
    const row = lines[24]!.split(",");
    expect(row[0]).toBe("2028-12");
    expect(Number(row[header.indexOf("metric_mrr")])).toBeCloseTo(result.summary.mrr, 6);
    expect(header).toContain("metric_nrr");
  });

  it("exports assumptions, node values, results, scenarios and Monte Carlo", () => {
    expect(assumptionsCsv(model).split("\r\n")[1]).toBe("p_signups,Starting signups,800,users,user,,accepted,,,,Signups.value,");
    expect(nodeValuesCsv(model, result).split("\r\n")[0]).toBe("period,node_id,node,output,value");
    const json = JSON.parse(resultsJson(model, result));
    expect(json.summary.mrr).toBe(result.summary.mrr);
    expect(json.guardrails[0].label).toBe("Gross margin > 55%");
    const sc = scenariosCsv(model, compareScenarios(model, [null, "slow"]));
    expect(sc).toContain("override,Slow growth,Signup growth,0.2,0.1");
    const m = parseModel({ ...acceptanceModel(), parameters: acceptanceModel().parameters!.map((p) => (p.id === "p_growth" ? { ...p, distribution: { type: "triangular" as const, min: 0.1, mode: 0.2, max: 0.3 } } : p)) });
    const mc = monteCarloCsv(runMonteCarlo(m, { runs: 50, seed: 1 }));
    expect(mc).toContain("distribution,mrr,");
    expect(mc).toContain("run,completed,50");
  });
});
