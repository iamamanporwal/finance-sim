import type { ChatRequest, ChatResponse, LLMProvider, ModelInfo, StructuredResponse, ToolDefinition } from "./types";
import { parseJson } from "./types";

export type ScriptedReply = string | ChatResponse["message"] | ((req: ChatRequest & { tools?: ToolDefinition[]; jsonSchema?: Record<string, unknown> }) => string | ChatResponse["message"]);

/**
 * Deterministic provider for tests: returns scripted replies in order and
 * records every request (fixed prompts → expected structured outputs).
 */
export class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  readonly requests: (ChatRequest & { tools?: ToolDefinition[]; jsonSchema?: Record<string, unknown> })[] = [];
  private index = 0;

  constructor(private readonly replies: ScriptedReply[]) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ name: "scripted" }];
  }

  private next(req: ChatRequest & { tools?: ToolDefinition[]; jsonSchema?: Record<string, unknown> }): ChatResponse["message"] {
    this.requests.push(req);
    const r = this.replies[this.index++];
    if (r === undefined) throw new Error(`ScriptedProvider ran out of replies after ${this.index - 1}.`);
    const v = typeof r === "function" ? r(req) : r;
    return typeof v === "string" ? { role: "assistant", content: v } : v;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return { message: this.next(req), model: "scripted" };
  }

  async tools(req: ChatRequest & { tools: ToolDefinition[] }): Promise<ChatResponse> {
    return { message: this.next(req), model: "scripted" };
  }

  async structured(req: ChatRequest & { jsonSchema: Record<string, unknown> }): Promise<StructuredResponse> {
    const m = this.next(req);
    return { raw: m.content, ...parseJson(m.content), model: "scripted" };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    yield this.next(req).content;
  }
}
