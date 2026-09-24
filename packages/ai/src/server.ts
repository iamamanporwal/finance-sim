import { z } from "zod";
import { OllamaProvider } from "./ollama";
import { AIProviderError, type LLMProvider } from "./types";

/**
 * Validation for requests arriving at the app's AI API routes. Limits keep a
 * single request bounded; the provider URL always comes from server config.
 */
const ToolCallSchema = z.object({ id: z.string().max(100), name: z.string().max(100), arguments: z.record(z.string(), z.unknown()) });
const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(100_000),
  toolCalls: z.array(ToolCallSchema).max(20).optional(),
  toolCallId: z.string().max(100).optional(),
  toolName: z.string().max(100).optional(),
});
const ModelNameSchema = z.string().regex(/^[\w.:\-/]+$/, "Invalid model name").max(120);

export const AICompleteRequestSchema = z.object({
  op: z.enum(["chat", "tools", "structured"]),
  model: ModelNameSchema.optional(),
  messages: z.array(MessageSchema).min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
  tools: z.array(z.object({ name: z.string().max(100), description: z.string().max(4000), parameters: z.record(z.string(), z.unknown()) })).max(40).optional(),
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
});

export const AIStreamRequestSchema = z.object({
  model: ModelNameSchema.optional(),
  messages: z.array(MessageSchema).min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
});

export interface ServerAIConfig {
  enabled: boolean;
  provider: "ollama";
  baseUrl: string;
  defaultModel?: string;
}

/** Reads provider configuration from environment variables (server only). */
export function readAIConfig(env: Record<string, string | undefined>): ServerAIConfig {
  return {
    enabled: (env.AI_PROVIDER ?? "ollama") !== "disabled",
    provider: "ollama",
    baseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434",
    defaultModel: env.OLLAMA_MODEL || undefined,
  };
}

export function createServerProvider(config: ServerAIConfig, fetchImpl?: typeof fetch): LLMProvider {
  if (!config.enabled) throw new AIProviderError("AI is disabled on this deployment.", "disabled", 503);
  return new OllamaProvider({ baseUrl: config.baseUrl, model: config.defaultModel, fetch: fetchImpl });
}

export async function handleComplete(provider: LLMProvider, body: unknown): Promise<unknown> {
  const req = AICompleteRequestSchema.parse(body);
  const base = { messages: req.messages, model: req.model, temperature: req.temperature };
  switch (req.op) {
    case "chat":
      return provider.chat(base);
    case "tools":
      return provider.tools({ ...base, tools: req.tools ?? [] });
    case "structured":
      if (!req.jsonSchema) throw new AIProviderError("structured requests need a jsonSchema.", "bad-response", 400);
      return provider.structured({ ...base, jsonSchema: req.jsonSchema });
  }
}

export function errorToResponseBody(e: unknown): { status: number; body: { error: string; code: string } } {
  if (e instanceof z.ZodError) return { status: 400, body: { error: `Invalid request: ${e.issues[0]?.message ?? "bad input"}`, code: "bad-request" } };
  if (e instanceof AIProviderError) {
    const status = e.code === "unreachable" ? 503 : e.code === "disabled" ? 503 : e.code === "model-not-found" ? 404 : e.status ?? 502;
    return { status, body: { error: e.message, code: e.code } };
  }
  return { status: 500, body: { error: "Unexpected AI error.", code: "internal" } };
}
