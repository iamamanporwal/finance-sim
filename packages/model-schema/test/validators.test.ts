import { describe, expect, it } from "vitest";
import {
  acceptanceModel,
  ModelSchema,
  ModelValidationError,
  NODE_CATALOG,
  NODE_TYPES,
  parseModel,
  slotsFor,
  outputsFor,
  validateModel,
  type ModelInput,
} from "../src";

type Mutator = (m: ModelInput) => void;

function withChange(change: Mutator) {
  const m = acceptanceModel();
  change(m);
  return validateModel(m);
}

const codes = (r: ReturnType<typeof validateModel>, severity: "error" | "warning" = "error") =>
  r.issues.filter((i) => i.severity === severity).map((i) => i.code);

describe("acceptance model", () => {
  it("is valid with no errors or warnings", () => {
    const r = validateModel(acceptanceModel());
    expect(r.issues).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("round-trips through JSON without loss", () => {
    const parsed = parseModel(acceptanceModel());
    const again = parseModel(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
  });

  it("applies schema defaults", () => {
    const m = parseModel(acceptanceModel());
    expect(m.schemaVersion).toBe(1);
    expect(m.version).toBe(1);
    const revenue = m.nodes.find((n) => n.id === "revenue")!;
    expect(revenue.type === "REVENUE" && revenue.config.revenueType).toBe("subscription");
    expect(m.connections[0]!.sourcePort).toBe("out");
    expect(m.parameters[0]!.status).toBe("accepted");
  });
});

describe("node catalog", () => {
  it("defines every node type", () => {
    for (const t of NODE_TYPES) expect(NODE_CATALOG[t].type).toBe(t);
  });
  it("resolves dynamic slots for costs, splits and formulas", () => {
    const m = parseModel(acceptanceModel());
    const cogs = m.nodes.find((n) => n.id === "cogs")!;
    expect(slotsFor(cogs).map((s) => s.name)).toEqual(["volume", "unitCost"]);

    const split = ModelSchema.shape.nodes.element.parse({
      id: "s", type: "SPLIT", label: "Plans", config: { branches: [{ key: "prime", label: "Prime" }, { key: "studio", label: "Studio" }] },
    });
    expect(slotsFor(split).map((s) => s.name)).toEqual(["input", "weight.prime", "weight.studio"]);
    expect(outputsFor(split).map((o) => o.name)).toEqual(["prime", "studio"]);

    const formula = ModelSchema.shape.nodes.element.parse({
      id: "f", type: "FORMULA", label: "ARPU", config: { expression: "revenue / max(customers, 1) + period * 0" },
    });
    expect(slotsFor(formula).map((s) => s.name)).toEqual(["customers", "revenue"]);
  });
});

describe("schema errors", () => {
  it("rejects non-object input", () => {
    expect(validateModel(null).valid).toBe(false);
    expect(validateModel("model").valid).toBe(false);
  });
  it("rejects invalid node types", () => {
    const r = withChange((m) => {
      (m.nodes[0] as { type: string }).type = "MAGIC";
    });
    expect(r.valid).toBe(false);
    expect(codes(r)).toContain("schema");
  });
  it("rejects malformed IDs", () => {
    const r = withChange((m) => {
      m.nodes[0]!.id = "has space";
    });
    expect(r.valid).toBe(false);
  });
  it("rejects non-finite values", () => {
    const r = withChange((m) => {
      m.parameters![0]!.value = Number.POSITIVE_INFINITY;
    });
    expect(r.valid).toBe(false);
  });
  it("rejects invalid settings", () => {
    expect(withChange((m) => void (m.settings.startDate = "2027-13")).valid).toBe(false);
    expect(withChange((m) => void (m.settings.horizon = 0)).valid).toBe(false);
    expect(withChange((m) => void ((m.settings as { timeStep: string }).timeStep = "hourly")).valid).toBe(false);
  });
  it("throws ModelValidationError from parseModel", () => {
    expect(() => parseModel({ ...acceptanceModel(), nodes: "x" })).toThrow(ModelValidationError);
  });
});

describe("unique IDs", () => {
  it("flags duplicate node IDs", () => {
    const r = withChange((m) => void (m.nodes[1]!.id = m.nodes[0]!.id));
    expect(codes(r)).toContain("duplicate-id");
  });
  it("flags duplicate parameter, connection and scenario IDs", () => {
    const r = withChange((m) => {
      m.parameters![1]!.id = m.parameters![0]!.id;
      m.connections![1]!.id = m.connections![0]!.id;
      m.scenarios![1]!.id = m.scenarios![0]!.id;
    });
    expect(codes(r).filter((c) => c === "duplicate-id").length).toBeGreaterThanOrEqual(3);
  });
});

describe("connections", () => {
  it("flags dangling connections", () => {
    const r = withChange((m) => void (m.connections![0]!.source = "ghost"));
    expect(codes(r)).toContain("dangling-connection");
  });
  it("flags self connections", () => {
    const r = withChange((m) => m.connections!.push({ id: "self", source: "growth", target: "growth", targetPort: "base" }));
    expect(codes(r)).toContain("self-connection");
  });
  it("flags unknown ports", () => {
    expect(codes(withChange((m) => void (m.connections![0]!.targetPort = "nope")))).toContain("invalid-port");
    expect(codes(withChange((m) => void (m.connections![0]!.sourcePort = "nope")))).toContain("invalid-port");
  });
  it("flags connecting into a parameter-only slot", () => {
    const r = withChange((m) => m.connections!.push({ id: "x", source: "signups", target: "customers", targetPort: "initial" }));
    expect(codes(r)).toContain("invalid-port");
  });
  it("flags multiple connections into a single input", () => {
    const r = withChange((m) => m.connections!.push({ id: "x", source: "signups", target: "revenue", targetPort: "price" }));
    expect(codes(r)).toContain("multiple-inputs");
  });
  it("allows multiple connections into a multi input", () => {
    const r = withChange((m) => m.connections!.push({ id: "x", source: "signups", target: "conversion", targetPort: "input" }));
    expect(codes(r)).not.toContain("multiple-inputs");
  });
  it("flags duplicate connections", () => {
    const r = withChange((m) => m.connections!.push({ ...m.connections![7]!, id: "dup" }));
    expect(codes(r)).toContain("duplicate-connection");
  });
});

describe("inputs and parameters", () => {
  it("flags a missing required input", () => {
    const r = withChange((m) => void (m.connections = m.connections!.filter((c) => c.id !== "c6")));
    expect(r.issues.find((i) => i.code === "missing-input")?.message).toBe('Subscription revenue: "Price" is required. Connect a node or enter a value.');
  });
  it("flags a node referencing a missing parameter", () => {
    const r = withChange((m) => void (m.nodes[0]!.parameters = { value: "ghost" }));
    expect(codes(r)).toContain("missing-parameter");
  });
  it("flags an unknown slot", () => {
    const r = withChange((m) => void (m.nodes[0]!.parameters = { value: "p_signups", bogus: "p_price" }));
    expect(codes(r)).toContain("unknown-slot");
  });
  it("flags a conversion rate above 100%", () => {
    const r = withChange((m) => void (m.parameters!.find((p) => p.id === "p_conversion")!.value = 1.5));
    expect(r.issues.find((i) => i.code === "out-of-range")?.message).toBe("Conversion: Conversion rate must be between 0% and 100%.");
  });
  it("flags a negative price", () => {
    const r = withChange((m) => void (m.parameters!.find((p) => p.id === "p_price")!.value = -1));
    expect(codes(r)).toContain("out-of-range");
  });
  it("flags values outside the parameter's own min/max", () => {
    const r = withChange((m) => void (m.parameters!.find((p) => p.id === "p_growth")!.value = 2));
    expect(codes(r)).toContain("out-of-range");
  });
  it("flags min greater than max", () => {
    const r = withChange((m) => Object.assign(m.parameters!.find((p) => p.id === "p_growth")!, { min: 1, max: 0 }));
    expect(codes(r)).toContain("invalid-range");
  });
  it("flags invalid distributions", () => {
    const r = withChange((m) =>
      Object.assign(m.parameters!.find((p) => p.id === "p_churn")!, { distribution: { type: "triangular", min: 0.05, mode: 0.01, max: 0.1 } }),
    );
    expect(codes(r)).toContain("invalid-distribution");
  });
  it("warns on unknown units and unused parameters", () => {
    const r = withChange((m) => {
      m.parameters!.push({ id: "p_extra", name: "Extra", value: 1, unit: "bananas" });
    });
    expect(r.valid).toBe(true);
    expect(codes(r, "warning")).toEqual(expect.arrayContaining(["unknown-unit", "unused-parameter"]));
  });
  it("warns when a slot is both connected and set", () => {
    const r = withChange((m) => void (m.nodes.find((n) => n.id === "revenue")!.parameters = { price: "p_price" }));
    expect(codes(r, "warning")).toContain("input-overridden");
  });
});

describe("node-specific rules", () => {
  const withSplit = (weights: number[]) =>
    withChange((m) => {
      m.parameters!.push(
        { id: "w1", name: "Prime share", value: weights[0]!, unit: "percent" },
        { id: "w2", name: "Studio share", value: weights[1]!, unit: "percent" },
      );
      m.nodes.push({
        id: "split",
        type: "SPLIT",
        label: "Plan mix",
        parameters: { "weight.prime": "w1", "weight.studio": "w2" },
        config: { branches: [{ key: "prime", label: "Prime" }, { key: "studio", label: "Studio" }] },
      });
      m.connections!.push({ id: "cs", source: "conversion", target: "split", targetPort: "input" });
    });
  it("accepts split weights totalling 100% (decimal-exact)", () => expect(codes(withSplit([0.7, 0.3]))).not.toContain("split-total"));
  it("accepts 0.1 + 0.2 style weights exactly", () => {
    expect(codes(withSplit([0.83, 0.17]))).not.toContain("split-total");
  });
  it("flags split weights not totalling 100%", () => {
    const r = withSplit([0.7, 0.2]);
    expect(r.issues.find((i) => i.code === "split-total")?.message).toBe("Plan mix: shares must total 100% (currently 90%).");
  });
  it("flags invalid formulas with position", () => {
    const r = withChange((m) => {
      m.nodes.push({ id: "f", type: "FORMULA", label: "Bad", config: { expression: "revenue * (customers" } });
    });
    expect(r.issues.find((i) => i.code === "invalid-formula")?.message).toMatch(/^Bad: Missing "\)"/);
  });
  it("rejects formulas that try to call unknown functions", () => {
    const r = withChange((m) => {
      m.nodes.push({ id: "f", type: "FORMULA", label: "Hack", config: { expression: "eval(1)" } });
    });
    expect(codes(r)).toContain("invalid-formula");
  });
  it("warns on unit mismatches inside formulas", () => {
    const r = withChange((m) => {
      m.nodes.push({ id: "f", type: "FORMULA", label: "Mixed", config: { expression: "customers + price" } });
      m.connections!.push(
        { id: "f1", source: "customers", target: "f", targetPort: "customers" },
        { id: "f2", source: "price", target: "f", targetPort: "price" },
      );
    });
    expect(r.issues.find((i) => i.code === "unit-mismatch")?.message).toMatch(/different units \(customers and USD\)/);
  });
  it("validates step cost tiers", () => {
    const r = withChange((m) => {
      m.nodes.push({
        id: "hosting",
        type: "COST",
        label: "Hosting",
        config: { costType: "step", tiers: [{ upTo: 5000, cost: 1000 }, { upTo: 1000, cost: 500 }, { cost: 2000 }] },
      });
      m.connections!.push({ id: "h1", source: "customers", target: "hosting", targetPort: "volume" });
    });
    expect(codes(r)).toContain("invalid-tiers");
  });
});

describe("scenarios", () => {
  it("flags overrides of missing parameters", () => {
    const r = withChange((m) => m.scenarios![1]!.overrides!.push({ parameterId: "ghost", value: 1 }));
    expect(codes(r)).toContain("missing-parameter");
  });
  it("flags missing parent scenarios", () => {
    const r = withChange((m) => void (m.scenarios![1]!.parentId = "ghost"));
    expect(codes(r)).toContain("missing-scenario");
  });
  it("flags scenario inheritance cycles", () => {
    const r = withChange((m) => {
      m.scenarios![0]!.parentId = "slow";
      m.scenarios![1]!.parentId = "base";
    });
    expect(codes(r)).toContain("scenario-cycle");
  });
  it("validates override values against parameter limits", () => {
    const r = withChange((m) => void (m.scenarios![1]!.overrides![0]!.value = 5));
    expect(codes(r)).toContain("out-of-range");
  });
});

describe("guardrails", () => {
  it("flags unknown metrics", () => {
    const r = withChange((m) => void (m.guardrails![0]!.metric = "happiness"));
    expect(codes(r)).toContain("unknown-metric");
  });
});

describe("scenario overrides respect node ranges", () => {
  it("flags a scenario that sets conversion above 100%", () => {
    const r = withChange((m) => m.scenarios!.push({ id: "bad", name: "Bad", overrides: [{ parameterId: "p_conversion", value: 1.5 }] }));
    expect(r.issues.find((i) => i.scenarioId === "bad" && i.code === "out-of-range")?.message).toBe(
      'Conversion: Conversion rate in scenario "Bad" must be between 0% and 100%.',
    );
  });
});

describe("AI assumption review status", () => {
  it("warns about unreviewed AI assumptions and blocks rejected ones", () => {
    const pending = withChange((m) => Object.assign(m.parameters!.find((p) => p.id === "p_churn")!, { source: "ai", status: "pending" }));
    expect(pending.valid).toBe(true);
    expect(pending.issues.find((i) => i.code === "unreviewed-assumption")?.message).toBe('"Monthly churn" was suggested by AI and has not been reviewed yet.');
    const rejected = withChange((m) => Object.assign(m.parameters!.find((p) => p.id === "p_churn")!, { source: "ai", status: "rejected" }));
    expect(rejected.valid).toBe(false);
    expect(codes(rejected)).toContain("rejected-assumption");
  });
});
