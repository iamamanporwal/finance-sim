import { AIProviderError, type ChatRequest, type ChatResponse, type LLMProvider, type ModelInfo, type StructuredResponse, type ToolDefinition } from "./types";

export interface AIStatus {
  enabled: boolean;
  provider: string;
  reachable: boolean;
  baseUrl?: string;
  defaultModel?: string;
  models: ModelInfo[];
  error?: string;
}

/**
 * Browser-side provider: forwards every call to the app's own API routes,
 * which hold the provider configuration. No keys or provider URLs in the browser.
 */
export class ProxyProvider implements LLMProvider {
  readonly id = "proxy";

  constructor(
    private readonly options: { endpoint?: string; model?: string; fetch?: typeof fetch } = {},
  ) {}

  private get endpoint() {
    return this.options.endpoint ?? "/api/ai";
  }

  private get fetchImpl() {
    return this.options.fetch ?? fetch.bind(globalThis);
  }

  async status(): Promise<AIStatus> {
    const res = await this.fetchImpl(`${this.endpoint}/status`, { cache: "no-store" });
    return (await res.json()) as AIStatus;
  }

  async listModels(): Promise<ModelInfo[]> {
    return (await this.status()).models;
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    return this.call("chat", req);
  }

  tools(req: ChatRequest & { tools: ToolDefinition[] }): Promise<ChatResponse> {
    return this.call("tools", req);
  }

  structured(req: ChatRequest & { jsonSchema: Record<string, unknown> }): Promise<StructuredResponse> {
    return this.call("structured", req);
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const { signal, ...body } = req;
    const res = await this.fetchImpl(`${this.endpoint}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, model: req.model ?? this.options.model }), signal });
    if (!res.ok || !res.body) throw await toError(res);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  }

  private async call<T>(op: "chat" | "tools" | "structured", req: ChatRequest & { tools?: ToolDefinition[]; jsonSchema?: Record<string, unknown> }): Promise<T> {
    const { signal, ...body } = req;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.endpoint}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...body, model: req.model ?? this.options.model }),
        signal,
      });
    } catch {
      if (signal?.aborted) throw new AIProviderError("Request cancelled.", "aborted");
      throw new AIProviderError("Could not reach the app server.", "unreachable");
    }
    if (!res.ok) throw await toError(res);
    return (await res.json()) as T;
  }
}

async function toError(res: Response): Promise<AIProviderError> {
  try {
    const data = (await res.json()) as { error?: string; code?: AIProviderError["code"] };
    return new AIProviderError(data.error ?? `AI request failed (${res.status}).`, data.code ?? "http", res.status);
  } catch {
    return new AIProviderError(`AI request failed (${res.status}).`, "http", res.status);
  }
}
