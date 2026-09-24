import { describe, expect, it } from "vitest";
import { buildPeriods, monthsPerPeriod } from "../src";

const labels = (startDate: string, timeStep: "daily" | "weekly" | "monthly" | "quarterly" | "yearly", horizon: number) =>
  buildPeriods({ startDate, timeStep, horizon }).map((p) => p.label);

describe("time engine", () => {
  it("monthly: 24 periods from 2027-01", () => {
    const l = labels("2027-01", "monthly", 24);
    expect(l).toHaveLength(24);
    expect(l.slice(0, 3)).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(l[11]).toBe("2027-12");
    expect(l[23]).toBe("2028-12");
  });
  it("monthly: clamps the day of month (Jan 31 → Feb 28)", () => {
    const p = buildPeriods({ startDate: "2027-01-31", timeStep: "monthly", horizon: 3 });
    expect(p.map((x) => x.startDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("monthly: handles leap years", () => {
    expect(buildPeriods({ startDate: "2028-01-31", timeStep: "monthly", horizon: 2 })[1]!.startDate).toBe("2028-02-29");
  });
  it("daily crosses month and year boundaries", () => {
    expect(labels("2027-12-30", "daily", 4)).toEqual(["2027-12-30", "2027-12-31", "2028-01-01", "2028-01-02"]);
  });
  it("weekly advances 7 days", () => {
    expect(labels("2027-01-01", "weekly", 3)).toEqual(["2027-01-01", "2027-01-08", "2027-01-15"]);
  });
  it("quarterly", () => {
    expect(labels("2027-01", "quarterly", 5)).toEqual(["2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4", "2028-Q1"]);
  });
  it("yearly", () => {
    expect(labels("2027-01", "yearly", 3)).toEqual(["2027", "2028", "2029"]);
  });
  it("assigns 1-based indexes", () => {
    expect(buildPeriods({ startDate: "2027-01", timeStep: "monthly", horizon: 3 }).map((p) => p.index)).toEqual([1, 2, 3]);
  });
  it("months per period", () => {
    expect(monthsPerPeriod("monthly")).toBe(1);
    expect(monthsPerPeriod("quarterly")).toBe(3);
    expect(monthsPerPeriod("yearly")).toBe(12);
  });
});
