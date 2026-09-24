import { describe, expect, it } from "vitest";
import { extractNumbers, ungroundedNumbers } from "../src";

describe("grounding check", () => {
  it("reads currency, compact, percent and grouped numbers, ignoring dates and small counts", () => {
    const m = extractNumbers("MRR is $1.8M in 2028-12, up from $185,720 with 4,820 customers, 5% churn and 3 drivers.");
    expect(m.map((x) => x.text)).toEqual(["$1.8M", "$185,720", "4,820", "5%"]);
    expect(m[0]!.values).toEqual([1_800_000]);
    expect(m[3]!.values).toEqual([0.05, 5]);
  });

  it("accepts rounded engine values and flags invented ones", () => {
    const facts = [1_812_400, 185_720.4, 4820, 0.05, 39];
    expect(ungroundedNumbers("MRR is $1.8M: 4,820 customers paying $39, with 5% monthly churn.", facts)).toEqual([]);
    expect(ungroundedNumbers("MRR grew 42% to $1.8M and will reach $2.4M next year.", facts)).toEqual(["42%", "$2.4M"]);
  });
});
