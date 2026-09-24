import { validateForSimulation } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { buildModelFromAssumptions } from "../src/ai/builder";
import type { ExtractedAssumption } from "../src/ai/business-spec";
import { acceptAll, acceptAssumption, pendingAssumptions, rejectAssumption } from "../src/lib/assumption-review";

const a = (key: ExtractedAssumption["key"], value: number, source: "user" | "ai" = "user"): ExtractedAssumption => ({ key, value, source, confidence: source === "ai" ? "low" : "high" });
const build = () =>
  buildModelFromAssumptions({
    name: "t",
    assumptions: [a("visitors", 1000), a("conversion", 0.05), a("price", 39), a("churn", 0.03, "ai"), a("paymentFeeRate", 0.029, "ai"), a("startingCash", 100000)],
  });

describe("AI assumption review", () => {
  it("lists pending AI assumptions", () => {
    expect(pendingAssumptions(build()).map((p) => p.name).sort()).toEqual(["Monthly churn", "Payment processing fee"]);
  });
  it("accept keeps the value and the AI source tag", () => {
    const m = build();
    const churn = pendingAssumptions(m).find((p) => p.name === "Monthly churn")!;
    const next = acceptAssumption(m, churn.id);
    expect(next.parameters.find((p) => p.id === churn.id)).toMatchObject({ status: "accepted", source: "ai", value: 0.03 });
    expect(pendingAssumptions(acceptAll(m))).toEqual([]);
  });
  it("rejecting an AI-only cost node removes it", () => {
    const m = build();
    const fee = pendingAssumptions(m).find((p) => p.name === "Payment processing fee")!;
    const r = rejectAssumption(m, fee.id);
    expect(r.outcome).toBe("removed-node");
    expect(r.model.nodes.some((n) => n.label === "Payment fees")).toBe(false);
    expect(validateForSimulation(r.model).valid).toBe(true);
  });
  it("rejecting a required assumption blocks simulation until the user edits it", () => {
    const m = build();
    const churn = pendingAssumptions(m).find((p) => p.name === "Monthly churn")!;
    const r = rejectAssumption(m, churn.id);
    expect(r.outcome).toBe("marked-rejected");
    const v = validateForSimulation(r.model);
    expect(v.valid).toBe(false);
    expect(v.issues.find((i) => i.code === "rejected-assumption")?.message).toBe('"Monthly churn" was rejected. Enter your own value or remove it.');
  });
});
