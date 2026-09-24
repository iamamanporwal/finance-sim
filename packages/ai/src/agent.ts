import { z } from "zod";
import type { ChatMessage, LLMProvider, ToolCall, ToolDefinition } from "./types";

/**
 * A tool the AI may call. Arguments are validated with Zod before `run` sees
 * them; the AI never touches application state except through these handlers.
 */
export interface AgentTool<A = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  run(args: A): Promise<unknown> | unknown;
}

export interface ToolRun {
  call: ToolCall;
  ok: boolean;
  result: unknown;
}

export type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "tool-result"; run: ToolRun };

export interface AgentResult {
  messages: ChatMessage[];
  final: string;
  toolRuns: ToolRun[];
  /** True when the step limit stopped the loop. */
  truncated: boolean;
}

const MAX_RESULT_CHARS = 8000;

export function toolDefinitions(tools: readonly AgentTool<never>[]): ToolDefinition[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: z.toJSONSchema(t.parameters as z.ZodType) as Record<string, unknown> }));
}

/** Runs one tool call safely: unknown tools, bad arguments and handler errors become error results. */
export async function executeToolCall(tools: readonly AgentTool<never>[], call: ToolCall): Promise<ToolRun> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { call, ok: false, result: { error: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}.` } };
  const parsed = (tool.parameters as z.ZodType).safeParse(call.arguments ?? {});
  if (!parsed.success) {
    return { call, ok: false, result: { error: `Invalid arguments for ${call.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` } };
  }
  try {
    return { call, ok: true, result: await (tool as AgentTool<unknown>).run(parsed.data) };
  } catch (e) {
    return { call, ok: false, result: { error: e instanceof Error ? e.message : String(e) } };
  }
}

function serialize(result: unknown): string {
  const text = JSON.stringify(result);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated)` : text;
}

/**
 * Tool-calling loop: ask the model, execute any tool calls, feed results back,
 * repeat until the model answers without tools or the step limit is reached.
 */
export async function runAgent(opts: {
  provider: LLMProvider;
  tools: readonly AgentTool<never>[];
  messages: ChatMessage[];
  model?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}): Promise<AgentResult> {
  const messages = [...opts.messages];
  const defs = toolDefinitions(opts.tools);
  const toolRuns: ToolRun[] = [];
  const maxSteps = opts.maxSteps ?? 8;
  for (let step = 0; step < maxSteps; step++) {
    const res = await opts.provider.tools({ messages, tools: defs, model: opts.model, signal: opts.signal, temperature: 0.2 });
    const msg = res.message;
    messages.push(msg);
    if (msg.content) opts.onEvent?.({ type: "assistant", content: msg.content });
    if (!msg.toolCalls?.length) return { messages, final: msg.content, toolRuns, truncated: false };
    for (const call of msg.toolCalls) {
      opts.onEvent?.({ type: "tool-call", call });
      const run = await executeToolCall(opts.tools, call);
      toolRuns.push(run);
      opts.onEvent?.({ type: "tool-result", run });
      messages.push({ role: "tool", content: serialize(run.result), toolCallId: call.id, toolName: call.name });
    }
  }
  return { messages, final: "I stopped after the maximum number of steps. Here is what I did so far.", toolRuns, truncated: true };
}
