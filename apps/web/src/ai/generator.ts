import { generateWithRepair, type LLMProvider, type RepairAttempt, type RepairResult } from "@fin/ai";
import { BUSINESS_SPEC_JSON_SCHEMA, validateBusinessSpec, type BusinessSpec } from "./business-spec";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompts";

/**
 * Prompt → intent, entities and assumptions (structured output) → Zod + domain
 * validation → AI repair (up to 3 rounds). The graph is built afterwards by the
 * deterministic builder once the user has reviewed the assumptions.
 */
export function extractBusinessSpec(opts: {
  provider: LLMProvider;
  description: string;
  model?: string;
  signal?: AbortSignal;
  onAttempt?: (a: RepairAttempt) => void;
}): Promise<RepairResult<BusinessSpec>> {
  return generateWithRepair({
    provider: opts.provider,
    model: opts.model,
    signal: opts.signal,
    jsonSchema: BUSINESS_SPEC_JSON_SCHEMA,
    validate: validateBusinessSpec,
    onAttempt: opts.onAttempt,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: `Business description:\n"""\n${opts.description.slice(0, 4000)}\n"""` },
    ],
  });
}
