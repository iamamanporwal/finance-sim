import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AIProviderError,
  generateWithRepair,
  OllamaProvider,
  runAgent,
  ScriptedProvider,
  type AgentTool,
} from "../src";
import { AICompleteRequestSchema, createServerProvider, errorToResponseBody, handleComplete, readAIConfig } from "../src/server";

/** Minimal fake of Ollama's HTTP API. */
function fakeOllama(handler: (path: string, body: any) => { status?: number; json?: unknown; ndjson?: unknown[] }) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const r = handler(new URL(url).pathname, body);
    if (r.ndjson) {
      const text = r.ndjson.map((x) => JSON.stringify(x)).join("\n") + "\n";
      return new Response(new Blob([text]).stream(), { status: 200 });
    }
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("OllamaProvider", () => {
  it("lists installed models", async () => {
    const { f } = fakeOllama(() => ({ json: { models: [{ name: "gpt-oss:20b", size: 1, modified_at: "x" }] } }));
    expect(await new OllamaProvider({ fetch: f }).listModels()).toEqual([{ name: "gpt-oss:20b", size: 1, modifiedAt: "x" }]);
  });
  it("uses http://localhost:11434 by default", async () => {
    const { f, calls } = fakeOllama(() => ({ json: { models: [] } }));
    await new OllamaProvider({ fetch: f }).listModels();
    expect(calls[0]!.url).toBe("http://localhost:11434/api/tags");
  });
  it("chat sends the model and messages, non-streaming", async () => {
    const { f, calls } = fakeOllama(() => ({ json: { model: "m", message: { role: "assistant", content: "hi" } } }));
    const r = await new OllamaProvider({ fetch: f, model: "m" }).chat({ messages: [{ role: "user", content: "hello" }], temperature: 0 });
    expect(r.message.content).toBe("hi");
    expect(calls[0]!.body).toMatchObject({ model: "m", stream: false, messages: [{ role: "user", content: "hello" }], options: { temperature: 0 } });
  });
  it("tools maps tool definitions and tool calls", async () => {
    const { f, calls } = fakeOllama(() => ({ json: { model: "m", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "run_simulation", arguments: { scenario_id: "x" } } }] } } }));
    const r = await new OllamaProvider({ fetch: f, model: "m" }).tools({ messages: [{ role: "user", content: "run" }], tools: [{ name: "run_simulation", description: "d", parameters: { type: "object" } }] });
    expect(calls[0]!.body.tools).toEqual([{ type: "function", function: { name: "run_simulation", description: "d", parameters: { type: "object" } } }]);
    expect(r.message.toolCalls![0]).toMatchObject({ name: "run_simulation", arguments: { scenario_id: "x" } });
  });
  it("structured passes the JSON schema as format and parses the reply", async () => {
    const { f, calls } = fakeOllama(() => ({ json: { model: "m", message: { role: "assistant", content: '```json\n{"a":1}\n```' } } }));
    const r = await new OllamaProvider({ fetch: f, model: "m" }).structured({ messages: [{ role: "user", content: "x" }], jsonSchema: { type: "object" } });
    expect(calls[0]!.body.format).toEqual({ type: "object" });
    expect(r.json).toEqual({ a: 1 });
  });
  it("streams NDJSON chunks", async () => {
    const { f } = fakeOllama(() => ({ ndjson: [{ message: { content: "Hel" } }, { message: { content: "lo" } }, { done: true }] }));
    let text = "";
    for await (const chunk of new OllamaProvider({ fetch: f, model: "m" }).stream({ messages: [{ role: "user", content: "x" }] })) text += chunk;
    expect(text).toBe("Hello");
  });
  it("explains when Ollama is not running", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new OllamaProvider({ fetch: f, model: "m" }).chat({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      "Could not reach Ollama at http://localhost:11434. Is it running? Start it with `ollama serve`.",
    );
  });
  it("explains when a model is not installed", async () => {
    const { f } = fakeOllama(() => ({ status: 404, json: { error: "model 'x' not found" } }));
    await expect(new OllamaProvider({ fetch: f }).chat({ model: "x", messages: [{ role: "user", content: "x" }] })).rejects.toThrow("Run `ollama pull x`");
  });
  it("requires a model", async () => {
    const { f } = fakeOllama(() => ({ json: {} }));
    await expect(new OllamaProvider({ fetch: f }).chat({ messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(AIProviderError);
  });
});

describe("agent tool loop", () => {
  const calls: unknown[] = [];
  const tools: AgentTool<never>[] = [
    {
      name: "get_metric",
      description: "Get a metric",
      parameters: z.object({ metric: z.enum(["mrr", "cash"]) }) as never,
      run: (args: never) => {
        calls.push(args);
        return { metric: "mrr", value: 185720 };
      },
    },
  ];

  it("executes tool calls and feeds results back until a final answer", async () => {
    const provider = new ScriptedProvider([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "get_metric", arguments: { metric: "mrr" } }] },
      (req) => {
        const tool = req.messages[req.messages.length - 1]!;
        expect(tool).toMatchObject({ role: "tool", toolName: "get_metric", content: '{"metric":"mrr","value":185720}' });
        return "MRR is $185,720.";
      },
    ]);
    const r = await runAgent({ provider, tools, messages: [{ role: "user", content: "What is MRR?" }] });
    expect(r.final).toBe("MRR is $185,720.");
    expect(r.toolRuns).toHaveLength(1);
    expect(calls).toEqual([{ metric: "mrr" }]);
    expect(provider.requests[0]!.tools![0]!.parameters).toMatchObject({ type: "object", properties: { metric: { enum: ["mrr", "cash"] } } });
  });

  it("returns validation errors for bad arguments instead of running the tool", async () => {
    const provider = new ScriptedProvider([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "get_metric", arguments: { metric: "profit" } }] },
      { role: "assistant", content: "", toolCalls: [{ id: "2", name: "drop_database", arguments: {} }] },
      "done",
    ]);
    const r = await runAgent({ provider, tools, messages: [{ role: "user", content: "x" }] });
    expect(r.toolRuns[0]!.ok).toBe(false);
    expect(JSON.stringify(r.toolRuns[0]!.result)).toMatch(/Invalid arguments for get_metric: metric/);
    expect((r.toolRuns[1]!.result as { error: string }).error).toMatch(/^Unknown tool "drop_database"/);
  });

  it("stops after the step limit", async () => {
    const loop = { role: "assistant" as const, content: "", toolCalls: [{ id: "1", name: "get_metric", arguments: { metric: "cash" } }] };
    const r = await runAgent({ provider: new ScriptedProvider([loop, loop, loop]), tools, messages: [{ role: "user", content: "x" }], maxSteps: 3 });
    expect(r.truncated).toBe(true);
  });
});

describe("repair loop", () => {
  const Schema = z.object({ conversion: z.number().min(0).max(1) });
  const validate = (json: unknown) => {
    const r = Schema.safeParse(json);
    return r.success ? { ok: true as const, value: r.data } : { ok: false as const, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  };

  it("repairs invalid output using the validation errors", async () => {
    const provider = new ScriptedProvider([
      '{"conversion": 7}',
      (req) => {
        expect(req.messages[req.messages.length - 1]!.content).toMatch(/conversion: Too big/);
        return '{"conversion": 0.07}';
      },
    ]);
    const r = await generateWithRepair({ provider, messages: [{ role: "user", content: "7% conversion" }], jsonSchema: {}, validate });
    expect(r).toMatchObject({ ok: true, value: { conversion: 0.07 } });
    expect(r.attempts).toHaveLength(2);
  });

  it("gives up after 3 repairs and reports the problem instead of returning broken output", async () => {
    const provider = new ScriptedProvider(["not json", '{"conversion": 2}', '{"conversion": 3}', '{"conversion": 4}', '{"conversion": 0.1}']);
    const r = await generateWithRepair({ provider, messages: [{ role: "user", content: "x" }], jsonSchema: {}, validate });
    expect(r.ok).toBe(false);
    expect(r.attempts).toHaveLength(4);
    expect(r.attempts[0]!.errors[0]).toMatch(/not valid JSON/);
    if (!r.ok) expect(r.errors[0]).toMatch(/conversion: Too big/);
  });
});

describe("server request handling", () => {
  it("reads configuration from the environment", () => {
    expect(readAIConfig({})).toEqual({ enabled: true, provider: "ollama", baseUrl: "http://localhost:11434", defaultModel: undefined });
    expect(readAIConfig({ OLLAMA_BASE_URL: "http://gpu:11434", OLLAMA_MODEL: "gpt-oss:20b" })).toMatchObject({ baseUrl: "http://gpu:11434", defaultModel: "gpt-oss:20b" });
    expect(() => createServerProvider(readAIConfig({ AI_PROVIDER: "disabled" }))).toThrow(/disabled/);
  });
  it("rejects malformed requests and suspicious model names", () => {
    expect(AICompleteRequestSchema.safeParse({ op: "chat", messages: [] }).success).toBe(false);
    expect(AICompleteRequestSchema.safeParse({ op: "chat", model: "../../etc", messages: [{ role: "user", content: "x" }] }).success).toBe(true);
    expect(AICompleteRequestSchema.safeParse({ op: "chat", model: "a b; rm -rf", messages: [{ role: "user", content: "x" }] }).success).toBe(false);
    expect(AICompleteRequestSchema.safeParse({ op: "eval", messages: [{ role: "user", content: "x" }] }).success).toBe(false);
  });
  it("dispatches operations to the provider", async () => {
    const p = new ScriptedProvider(["hello"]);
    expect(await handleComplete(p, { op: "chat", messages: [{ role: "user", content: "x" }] })).toMatchObject({ message: { content: "hello" } });
  });
  it("maps errors to HTTP responses", () => {
    expect(errorToResponseBody(new AIProviderError("down", "unreachable")).status).toBe(503);
    expect(errorToResponseBody(new AIProviderError("no model", "model-not-found")).status).toBe(404);
    expect(errorToResponseBody(new Error("secret internals")).body.error).toBe("Unexpected AI error.");
  });
});
