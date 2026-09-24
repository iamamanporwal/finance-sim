/** Provider-independent LLM types. Nothing here knows about Ollama or any vendor. */
export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Assistant messages may request tool calls. */
  toolCalls?: ToolCall[];
  /** Tool messages answer a specific call. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Model name; providers fall back to their configured default. */
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  message: ChatMessage;
  model: string;
}

export interface StructuredResponse {
  /** Raw text the model returned. */
  raw: string;
  /** Parsed JSON, when the text was valid JSON. */
  json?: unknown;
  parseError?: string;
  model: string;
}

export interface ModelInfo {
  name: string;
  size?: number;
  modifiedAt?: string;
}

export interface LLMProvider {
  readonly id: string;
  listModels(): Promise<ModelInfo[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<string>;
  /** Asks for JSON matching `jsonSchema`. Validation is the caller's job (see generateWithRepair). */
  structured(request: ChatRequest & { jsonSchema: Record<string, unknown> }): Promise<StructuredResponse>;
  /** Chat with tools available; the response may contain tool calls. */
  tools(request: ChatRequest & { tools: ToolDefinition[] }): Promise<ChatResponse>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly code: "unreachable" | "model-not-found" | "bad-response" | "http" | "disabled" | "aborted",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export function parseJson(text: string): { json?: unknown; parseError?: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return { json: JSON.parse(trimmed) };
  } catch (e) {
    return { parseError: e instanceof Error ? e.message : String(e) };
  }
}
