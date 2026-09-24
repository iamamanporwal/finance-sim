import { AIProviderError, parseJson, type ChatMessage, type ChatRequest, type ChatResponse, type LLMProvider, type ModelInfo, type StructuredResponse, type ToolDefinition } from "./types";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export interface OllamaOptions {
  baseUrl?: string;
  /** Default model when a request does not name one. */
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  tool_name?: string;
}

/**
 * Ollama's native API (/api/chat, /api/tags). Supports streaming, tool calling
 * and JSON-schema structured output. Server-side only: the browser talks to
 * our API routes, never to Ollama directly.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  readonly baseUrl: string;
  readonly defaultModel: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
    this.defaultModel = options.model || undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async listModels(): Promise<ModelInfo[]> {
    const data = (await this.request("/api/tags", undefined, "GET")) as { models?: { name: string; size?: number; modified_at?: string }[] };
    return (data.models ?? []).map((m) => ({ name: m.name, size: m.size, modifiedAt: m.modified_at }));
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.complete(req, {});
  }

  async tools(req: ChatRequest & { tools: ToolDefinition[] }): Promise<ChatResponse> {
    return this.complete(req, { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) });
  }

  async structured(req: ChatRequest & { jsonSchema: Record<string, unknown> }): Promise<StructuredResponse> {
    const res = await this.complete(req, { format: req.jsonSchema });
    return { raw: res.message.content, ...parseJson(res.message.content), model: res.model };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const res = await this.raw("/api/chat", { model: this.model(req), messages: req.messages.map(toOllama), stream: true, options: options(req) }, "POST", req.signal);
    if (!res.body) throw new AIProviderError("Ollama returned an empty stream.", "bad-response");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (chunk.error) throw new AIProviderError(chunk.error, "http");
        if (chunk.message?.content) yield chunk.message.content;
      }
    }
  }

  private model(req: ChatRequest): string {
    const m = req.model || this.defaultModel;
    if (!m) throw new AIProviderError("No Ollama model selected. Choose one in Settings or set OLLAMA_MODEL.", "model-not-found");
    return m;
  }

  private async complete(req: ChatRequest, extra: Record<string, unknown>): Promise<ChatResponse> {
    const model = this.model(req);
    const data = (await this.request("/api/chat", { model, messages: req.messages.map(toOllama), stream: false, options: options(req), ...extra }, "POST", req.signal)) as {
      message?: OllamaMessage;
      model?: string;
    };
    if (!data.message) throw new AIProviderError("Ollama returned no message.", "bad-response");
    return { message: fromOllama(data.message), model: data.model ?? model };
  }

  private async request(path: string, body: unknown, method: "GET" | "POST", signal?: AbortSignal): Promise<unknown> {
    const res = await this.raw(path, body, method, signal);
    try {
      return await res.json();
    } catch {
      throw new AIProviderError("Ollama returned invalid JSON.", "bad-response");
    }
  }

  private async raw(path: string, body: unknown, method: "GET" | "POST", signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      });
    } catch (e) {
      if (signal?.aborted) throw new AIProviderError("Request cancelled.", "aborted");
      throw new AIProviderError(`Could not reach Ollama at ${this.baseUrl}. Is it running? Start it with \`ollama serve\`.`, "unreachable");
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: string }).error ?? "";
      } catch {
        // ignore
      }
      if (res.status === 404 && /model/i.test(detail)) {
        const name = (body as { model?: string } | undefined)?.model ?? "";
        throw new AIProviderError(`Model "${name}" is not installed in Ollama. Run \`ollama pull ${name}\`.`, "model-not-found", 404);
      }
      throw new AIProviderError(`Ollama error (${res.status}): ${detail || res.statusText}`, "http", res.status);
    }
    return res;
  }
}

function options(req: ChatRequest) {
  return req.temperature === undefined ? undefined : { temperature: req.temperature };
}

function toOllama(m: ChatMessage): OllamaMessage {
  const out: OllamaMessage = { role: m.role, content: m.content };
  if (m.toolCalls?.length) out.tool_calls = m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }));
  if (m.role === "tool" && m.toolName) out.tool_name = m.toolName;
  return out;
}

let callCounter = 0;
function fromOllama(m: OllamaMessage): ChatMessage {
  const toolCalls = (m.tool_calls ?? []).map((c) => {
    let args = c.function.arguments;
    if (typeof args === "string") {
      const parsed = parseJson(args);
      args = (parsed.json as Record<string, unknown> | undefined) ?? {};
    }
    return { id: `call_${++callCounter}`, name: c.function.name, arguments: args ?? {} };
  });
  return { role: "assistant", content: m.content ?? "", ...(toolCalls.length ? { toolCalls } : {}) };
}
