import { extractNumbers, generateWithRepair, ungroundedNumbers, type LLMProvider, type RepairResult } from "@fin/ai";
import type { WhyExplanation, WhyStep } from "@fin/simulation-engine";
import { z } from "zod";
import { WHY_SYSTEM_PROMPT } from "./prompts";

const WhyAnswerSchema = z.object({ explanation: z.string().min(1).max(1500) });
const WHY_JSON_SCHEMA = z.toJSONSchema(WhyAnswerSchema) as Record<string, unknown>;

/** The engine's explanation tree as indented text: the only facts the AI may use. */
export function whyFactsText(e: WhyExplanation, format: (v: number | null, kind: WhyStep["valueKind"]) => string, maxLines = 60): string {
  const lines: string[] = [`Period: ${e.periodLabel}${e.scenarioId ? ` (scenario ${e.scenarioId})` : ""}`, `Main chain: ${e.chain.join(" ← ")}`];
  const walk = (s: WhyStep, depth: number) => {
    if (lines.length >= maxLines) return;
    const tag = s.kind === "assumption" ? ` [assumption${s.source && s.source !== "user" ? `, source ${s.source}` : ""}${s.confidence ? `, ${s.confidence} confidence` : ""}]` : s.kind === "default" ? " [default]" : s.repeated ? " [see above]" : "";
    lines.push(`${"  ".repeat(depth)}- ${s.label} = ${format(s.value, s.valueKind)}${tag}${s.formula && s.kind !== "assumption" ? ` — ${s.formula}` : ""}`);
    for (const c of s.children) walk(c, depth + 1);
  };
  walk(e.root, 0);
  return lines.join("\n");
}

/**
 * Asks the AI to turn the engine's explanation into plain English. The answer is
 * rejected (and repaired, up to 3 times) when it contains any number that is not
 * in the engine output.
 */
export function explainWithAI(opts: {
  provider: LLMProvider;
  model?: string;
  explanation: WhyExplanation;
  format: (v: number | null, kind: WhyStep["valueKind"]) => string;
  question?: string;
  signal?: AbortSignal;
}): Promise<RepairResult<string>> {
  const facts = whyFactsText(opts.explanation, opts.format);
  const allowed = [...opts.explanation.facts.map((f) => f.value), ...extractNumbers(facts).flatMap((m) => m.values)];
  return generateWithRepair({
    provider: opts.provider,
    model: opts.model,
    signal: opts.signal,
    jsonSchema: WHY_JSON_SCHEMA,
    validate: (json) => {
      const parsed = WhyAnswerSchema.safeParse(json);
      if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
      const bad = ungroundedNumbers(parsed.data.explanation, allowed);
      if (bad.length) return { ok: false, errors: [`These numbers are not in the engine output: ${bad.join(", ")}. Use only numbers from the facts, exactly as given; do not calculate new ones.`] };
      return { ok: true, value: parsed.data.explanation };
    },
    messages: [
      { role: "system", content: WHY_SYSTEM_PROMPT },
      { role: "user", content: `${opts.question ?? `Why is ${opts.explanation.root.label} ${opts.format(opts.explanation.root.value, opts.explanation.root.valueKind)}?`}\n\nEngine facts:\n${facts}` },
    ],
  });
}
