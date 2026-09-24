import { describe, expect, it } from "vitest";
import { formatByUnit, formatCount, formatCurrency, formatMonths, formatPercent } from "../src/lib/format";
import { distributionForLevel, uncertaintyLevel } from "../src/lib/uncertainty";

describe("formatting never shows NaN/Infinity/undefined", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, null])("%s", (v) => {
    for (const s of [formatCurrency(v), formatPercent(v), formatCount(v)]) {
      expect(s).toBe("—");
    }
  });
  it("labels null runway", () => expect(formatMonths(null)).toBe("Not burning"));
});

describe("formatting", () => {
  it("currency", () => {
    expect(formatCurrency(2184)).toBe("$2,184");
    expect(formatCurrency(1_240_000)).toBe("$1.24M");
    expect(formatCurrency(39.5)).toBe("$39.5");
  });
  it("percent from fractions", () => expect(formatPercent(0.7948)).toBe("79.5%"));
  it("by unit", () => {
    expect(formatByUnit(0.07, "percent")).toBe("7%");
    expect(formatByUnit(8, "USD/customers")).toBe("$8/customers");
    expect(formatByUnit(800, "users")).toBe("800 users");
  });
});

describe("uncertainty levels", () => {
  it("round-trips levels through triangular distributions", () => {
    for (const level of ["low", "medium", "high"] as const) {
      expect(uncertaintyLevel({ value: 0.2, distribution: distributionForLevel(0.2, level) })).toBe(level);
    }
    expect(uncertaintyLevel({ value: 5, distribution: undefined })).toBe("none");
    expect(uncertaintyLevel({ value: 5, distribution: { type: "uniform", min: 1, max: 9 } })).toBe("custom");
  });
  it("clamps to bounds (rates cannot exceed 100%)", () => {
    const d = distributionForLevel(0.9, "high", { min: 0, max: 1 });
    expect(d).toEqual({ type: "triangular", min: 0.45, mode: 0.9, max: 1 });
    expect(uncertaintyLevel({ value: 0.9, distribution: d })).toBe("high");
  });
});
