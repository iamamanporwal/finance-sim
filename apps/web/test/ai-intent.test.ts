import { describe, expect, it } from "vitest";
import { requiresTools } from "../src/ai/intent";

describe("tool-use enforcement", () => {
  it.each(["Increase pricing by 20%.", "What happens if churn doubles?", "Run a downside scenario.", "What happens if AI costs increase 50%?", "Compare hiring vs marketing.", "Run 10,000 simulations.", "Why is MRR $1.8M?", "How long is our runway?"])("%s needs tools", (t) => {
    expect(requiresTools(t)).toBe(true);
  });
  it.each(["hi", "Thanks!", "what can you do?"])("%s does not", (t) => {
    expect(requiresTools(t)).toBe(false);
  });
});
