import type { ChatMessage, LLMProvider } from "./types";

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface RepairAttempt {
  attempt: number;
  raw: string;
  errors: string[];
}

export type RepairResult<T> =
  | { ok: true; value: T; attempts: RepairAttempt[] }
  | { ok: false; errors: string[]; attempts: RepairAttempt[] };

export const MAX_REPAIR_ATTEMPTS = 3;

/**
 * Generate → validate → repair loop:
 *   AI output → validation (Zod + model rules) → errors → AI repair → validation …
 * Up to `maxRepairs` repair rounds after the first attempt. When the output is
 * still invalid, the errors are returned so the UI can show the problem.
 * Nothing invalid is ever returned as a value.
 */
export async function generateWithRepair<T>(opts: {
  provider: LLMProvider;
  messages: ChatMessage[];
  jsonSchema: Record<string, unknown>;
  validate: (json: unknown) => Validation<T>;
  model?: string;
  maxRepairs?: number;
  signal?: AbortSignal;
  onAttempt?: (a: RepairAttempt) => void;
}): Promise<RepairResult<T>> {
  const maxRepairs = opts.maxRepairs ?? MAX_REPAIR_ATTEMPTS;
  const messages = [...opts.messages];
  const attempts: RepairAttempt[] = [];
  for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
    const res = await opts.provider.structured({ messages, jsonSchema: opts.jsonSchema, model: opts.model, signal: opts.signal, temperature: 0 });
    let errors: string[];
    if (res.json === undefined) {
      errors = [`The response was not valid JSON (${res.parseError ?? "could not parse"}).`];
    } else {
      const v = opts.validate(res.json);
      if (v.ok) {
        attempts.push({ attempt, raw: res.raw, errors: [] });
        opts.onAttempt?.(attempts[attempts.length - 1]!);
        return { ok: true, value: v.value, attempts };
      }
      errors = v.errors;
    }
    attempts.push({ attempt, raw: res.raw, errors });
    opts.onAttempt?.(attempts[attempts.length - 1]!);
    messages.push(
      { role: "assistant", content: res.raw },
      {
        role: "user",
        content: `Your JSON has these problems:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn the complete corrected JSON only, following the schema exactly.`,
      },
    );
  }
  return { ok: false, errors: attempts[attempts.length - 1]!.errors, attempts };
}
