import { describe, expect, it } from "vitest";
import { checkUnits, formatUnit, isKnownUnit, parseUnit } from "../src";

const units = { price: "USD", customers: "customers", signups: "users", churn: "percent", cogs: "USD/customers", months: "months", fx: "INR" };
const check = (src: string) => checkUnits(src, units);

describe("parseUnit / formatUnit", () => {
  it("parses simple and compound units", () => {
    expect(parseUnit("USD")).toEqual({ USD: 1 });
    expect(parseUnit("USD/customers")).toEqual({ USD: 1, customers: -1 });
    expect(parseUnit("$/customer")).toEqual({ USD: 1, customers: -1 });
    expect(parseUnit("percent")).toEqual({});
    expect(parseUnit(undefined)).toEqual({});
  });
  it("formats units", () => {
    expect(formatUnit({ USD: 1, customers: -1 })).toBe("USD/customers");
    expect(formatUnit({})).toBe("number");
  });
  it("knows the supported units", () => {
    for (const u of ["USD", "INR", "customers", "users", "credits", "percent", "months", "years", "USD/customers"]) {
      expect(isKnownUnit(u), u).toBe(true);
    }
    expect(isKnownUnit("bananas")).toBe(false);
  });
});

describe("checkUnits", () => {
  it("money × count is valid and yields USD·customers", () => {
    const r = check("price * customers");
    expect(r.warnings).toEqual([]);
    expect(formatUnit(r.unit!)).toBe("customers·USD");
  });
  it("cost per customer × customers yields USD", () => {
    const r = check("cogs * customers");
    expect(r.warnings).toEqual([]);
    expect(r.unit).toEqual({ USD: 1 });
  });
  it("warns on 20 customers + $500", () => {
    const r = check("customers + price");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.message).toMatch(/different units \(customers and USD\)/);
  });
  it("warns when mixing currencies", () => expect(check("price + fx").warnings).toHaveLength(1));
  it("warns when mixing customers and users", () => expect(check("customers - signups").warnings).toHaveLength(1));
  it("literals adopt the unit of the other operand", () => {
    expect(check("price + 5").warnings).toEqual([]);
    expect(check("price + 5").unit).toEqual({ USD: 1 });
  });
  it("percent scales without changing units", () => {
    const r = check("customers * churn");
    expect(r.warnings).toEqual([]);
    expect(r.unit).toEqual({ customers: 1 });
  });
  it("division cancels units", () => expect(check("price / price").unit).toEqual({}));
  it("warns on comparisons across units", () => expect(check("if(customers > price, 1, 0)").warnings).toHaveLength(1));
  it("warns on mismatched if branches", () => expect(check("if(churn > 5%, price, customers)").warnings).toHaveLength(1));
  it("warns on mixed min/max arguments", () => expect(check("max(price, customers)").warnings).toHaveLength(1));
  it("integer powers scale units", () => expect(check("price ^ 2").unit).toEqual({ USD: 2 }));
  it("unknown variables are treated as unitless-adaptive", () => expect(check("mystery + price").warnings).toEqual([]));
});
