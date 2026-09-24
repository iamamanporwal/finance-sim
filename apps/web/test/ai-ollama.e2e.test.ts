/**
 * Live test against a local Ollama. Skipped unless OLLAMA_E2E=1.
 *   OLLAMA_E2E=1 OLLAMA_MODEL=gpt-oss:20b pnpm vitest run apps/web/test/ai-ollama.e2e.test.ts
 */
import { OllamaProvider } from "@fin/ai";
import { simulate, validateForSimulation } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import { buildModelFromAssumptions } from "../src/ai/builder";
import { extractBusinessSpec } from "../src/ai/generator";

const enabled = process.env.OLLAMA_E2E === "1";

describe.skipIf(!enabled)("live Ollama extraction", () => {
  it(
    "extracts the plan's example business and builds a valid model",
    async () => {
      const provider = new OllamaProvider({ baseUrl: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL ?? "gpt-oss:20b", timeoutMs: 300_000 });
      const r = await extractBusinessSpec({
        provider,
        description: "I run an AI SaaS with 1,000 visitors per month, 5% conversion, $39 pricing, 4% churn and $8 COGS.",
        onAttempt: (a) => console.log(`attempt ${a.attempt}: ${a.errors.length ? a.errors.join("; ") : "valid"}`),
      });
      if (!r.ok) console.log(r.errors, r.attempts.map((a) => a.raw));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      console.log(JSON.stringify(r.value, null, 1));
      const byKey = Object.fromEntries(r.value.assumptions.map((a) => [a.key, a]));
      expect(byKey.visitors?.value).toBe(1000);
      expect(byKey.conversion?.value).toBeCloseTo(0.05, 10);
      expect(byKey.price?.value).toBe(39);
      expect(byKey.churn?.value).toBeCloseTo(0.04, 10);
      expect(byKey.cogsPerCustomer?.value).toBe(8);
      for (const k of ["visitors", "conversion", "price", "churn", "cogsPerCustomer"]) expect(byKey[k]?.source).toBe("user");
      expect(byKey.startingCash).toBeUndefined(); // never invented
      const m = buildModelFromAssumptions({ name: r.value.name, assumptions: r.value.assumptions });
      expect(validateForSimulation(m).valid).toBe(true);
      expect(simulate(m).timeline[0]!.revenue.total).toBe(1950);
    },
    600_000,
  );
});
