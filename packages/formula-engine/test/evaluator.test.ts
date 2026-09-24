import { describe, expect, it } from "vitest";
import { compileFormula, evaluate, evaluateFormula, FormulaError, parseFormula } from "../src";

const ev = (src: string, vars: Record<string, number | string> = {}) => evaluateFormula(src, vars).toString();

describe("arithmetic", () => {
  it("evaluates the plan example: customers * price", () => {
    expect(ev("customers * price", { customers: 100, price: 39 })).toBe("3900");
  });
  it("adds", () => expect(ev("1 + 2")).toBe("3"));
  it("subtracts", () => expect(ev("10 - 4 - 3")).toBe("3"));
  it("multiplies", () => expect(ev("6 * 7")).toBe("42"));
  it("divides", () => expect(ev("10 / 4")).toBe("2.5"));
  it("respects precedence", () => expect(ev("2 + 3 * 4")).toBe("14"));
  it("respects parentheses", () => expect(ev("(2 + 3) * 4")).toBe("20"));
  it("handles nested parentheses", () => expect(ev("((1 + 2) * (3 + 4)) / 7")).toBe("3"));
  it("handles unary minus", () => expect(ev("-5 + 2")).toBe("-3"));
  it("handles double unary", () => expect(ev("--5")).toBe("5"));
  it("handles unary plus", () => expect(ev("+5")).toBe("5"));
  it("exponent is right associative", () => expect(ev("2 ^ 3 ^ 2")).toBe("512"));
  it("exponent binds tighter than unary minus", () => expect(ev("-2 ^ 2")).toBe("-4"));
  it("supports negative exponents", () => expect(ev("2 ^ -1")).toBe("0.5"));
  it("supports compound growth", () => expect(ev("800 * (1 + g) ^ 2", { g: 0.2 })).toBe("1152"));
  it("parses decimals and scientific notation", () => {
    expect(ev(".5 + 1.25")).toBe("1.75");
    expect(ev("1e3 + 2E-1")).toBe("1000.2");
  });
  it("allows digit separators", () => expect(ev("20_000 + 1")).toBe("20001"));
});

describe("percent", () => {
  it("treats postfix % as divide by 100", () => expect(ev("20%")).toBe("0.2"));
  it("applies percent inside expressions", () => expect(ev("39 * (1 - 10%)")).toBe("35.1"));
  it("applies percent to a group", () => expect(ev("(10 + 10)%")).toBe("0.2"));
  it("rejects % used as binary modulo", () => expect(() => ev("10 % 3")).toThrow(FormulaError));
});

describe("decimal precision", () => {
  it("does not suffer floating-point drift", () => {
    expect(ev("0.1 + 0.2")).toBe("0.3");
    expect(ev("1.1 * 3")).toBe("3.3");
  });
  it("keeps cents exact when summing many values", () => {
    const src = Array.from({ length: 200 }, () => "0.01").join("+");
    expect(ev(src)).toBe("2");
  });
});

describe("comparisons", () => {
  it.each([
    ["3 > 2", "1"],
    ["2 > 3", "0"],
    ["3 >= 3", "1"],
    ["2 < 3", "1"],
    ["3 <= 2", "0"],
    ["3 == 3", "1"],
    ["3 != 3", "0"],
    ["1 + 1 == 2", "1"],
  ])("%s → %s", (src, expected) => expect(ev(src)).toBe(expected));
});

describe("functions", () => {
  it("min", () => expect(ev("min(3, 1, 2)")).toBe("1"));
  it("max", () => expect(ev("max(3, 1, 2)")).toBe("3"));
  it("sum", () => expect(ev("sum(1, 2, 3.5)")).toBe("6.5"));
  it("average", () => expect(ev("average(1, 2, 3, 4)")).toBe("2.5"));
  it("abs", () => expect(ev("abs(-4.2)")).toBe("4.2"));
  it("round defaults to 0 digits, half away from zero", () => {
    expect(ev("round(2.5)")).toBe("3");
    expect(ev("round(-2.5)")).toBe("-3");
    expect(ev("round(2.4)")).toBe("2");
  });
  it("round with digits", () => expect(ev("round(3.14159, 2)")).toBe("3.14"));
  it("floor/ceil", () => {
    expect(ev("floor(2.7)")).toBe("2");
    expect(ev("ceil(2.1)")).toBe("3");
  });
  it("sqrt", () => expect(ev("sqrt(16)")).toBe("4"));
  it("pow", () => expect(ev("pow(1.2, 2)")).toBe("1.44"));
  it("mod", () => expect(ev("mod(10, 3)")).toBe("1"));
  it("if picks the true branch", () => expect(ev("if(1 > 0, 10, 20)")).toBe("10"));
  it("if picks the false branch", () => expect(ev("if(1 < 0, 10, 20)")).toBe("20"));
  it("if is lazy: the unused branch is never evaluated", () => {
    expect(ev("if(x > 0, 100 / x, 0)", { x: 0 })).toBe("0");
  });
  it("and / or / not", () => {
    expect(ev("and(1, 2 > 1)")).toBe("1");
    expect(ev("and(1, 0)")).toBe("0");
    expect(ev("or(0, 0, 3)")).toBe("1");
    expect(ev("not(0)")).toBe("1");
  });
  it("function names are case-insensitive", () => expect(ev("MAX(1, 2)")).toBe("2"));
});

describe("history functions", () => {
  const history = { revenue: ["100", "110", "121"] }; // oldest → newest (previous periods)
  const ctx = {
    variables: { revenue: 133.1 },
    history: (name: string, lag: number) => {
      const h = history[name as "revenue"];
      return h?.[h.length - lag];
    },
  };
  it("previous()", () => expect(evaluate(parseFormula("previous(revenue)"), ctx).toString()).toBe("121"));
  it("lag()", () => expect(evaluate(parseFormula("lag(revenue, 3)"), ctx).toString()).toBe("100"));
  it("growth()", () => expect(evaluate(parseFormula("growth(revenue)"), ctx).toString()).toBe("0.1"));
  it("errors when history is missing", () => {
    expect(() => evaluate(parseFormula("lag(revenue, 5)"), ctx)).toThrow(/5 period/);
  });
  it("requires a variable name", () => expect(() => parseFormula("previous(1 + 2)")).toThrow(/variable name/));
});

describe("variables", () => {
  it("supports dotted names", () => expect(ev("customers.new * 2", { "customers.new": 5 })).toBe("10"));
  it("accepts a resolver function", () => {
    expect(evaluateFormula("a + b", (n) => (n === "a" ? 1 : n === "b" ? 2 : undefined)).toString()).toBe("3");
  });
  it("compileFormula lists identifiers", () => {
    const f = compileFormula("if(churn > 5%, customers * price, previous(mrr))");
    expect([...f.identifiers].sort()).toEqual(["churn", "customers", "mrr", "price"]);
    expect(f.evaluate({ variables: { churn: 0.01, customers: 2, price: 3 }, history: () => 9 }).toString()).toBe("9");
  });
});

describe("errors", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof FormulaError ? `${e.kind}:${e.position}` : "other";
    }
    return "none";
  };
  it("division by zero", () => expect(() => ev("1 / 0")).toThrow("Division by zero."));
  it("mod by zero", () => expect(() => ev("mod(1, 0)")).toThrow(/Division by zero/));
  it("zero to a negative power", () => expect(() => ev("0 ^ -1")).toThrow(/Division by zero/));
  it("sqrt of a negative", () => expect(() => ev("sqrt(-1)")).toThrow(/negative/));
  it("unknown variable", () => expect(() => ev("foo + 1")).toThrow('Unknown variable "foo".'));
  it("unknown function", () => expect(code(() => parseFormula("eval(1)"))).toBe("syntax:0"));
  it("wrong arity", () => expect(() => parseFormula("if(1, 2)")).toThrow(/expects 3/));
  it("empty formula", () => expect(() => parseFormula("   ")).toThrow(/empty/));
  it("unbalanced parentheses", () => expect(() => parseFormula("(1 + 2")).toThrow(/Missing "\)"/));
  it("trailing operator", () => expect(() => parseFormula("1 +")).toThrow(/ends unexpectedly/));
  it("stray token reports its position", () => expect(code(() => parseFormula("1 2"))).toBe("syntax:2"));
  it("rejects JavaScript syntax", () => {
    for (const src of ["a = 1", "x => x", "a; b", "a[0]", "'str'", "a && b", "constructor.constructor('x')()"]) {
      expect(() => parseFormula(src), src).toThrow(FormulaError);
    }
  });
  it("prototype names are not resolved from the variables object", () => {
    expect(() => ev("constructor + 1")).toThrow(/Unknown variable/);
    expect(() => ev("toString")).toThrow(/Unknown variable/);
  });
  it("limits formula length", () => expect(() => parseFormula("1+".repeat(1500) + "1")).toThrow(/too long/));
  it("limits nesting depth", () => expect(() => parseFormula("(".repeat(100) + "1" + ")".repeat(100))).toThrow(/nested/));
  it("non-finite variables are rejected", () => expect(() => ev("x * 2", { x: Number.NaN })).toThrow(/finite/));
});
