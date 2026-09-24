import { OllamaProvider, runAgent, type ChatMessage } from "@fin/ai";
import { runMonteCarlo } from "@fin/monte-carlo";
import { instantiateTemplate } from "@fin/templates";
import { it } from "vitest";
import { COPILOT_SYSTEM_PROMPT } from "../src/ai/prompts";
import { createCopilotTools } from "../src/ai/tools";

it.skipIf(process.env.OLLAMA_E2E !== "1")("debug copilot", async () => {
  for (const q of [process.env.Q ?? "Run 10,000 simulations."]) {
    let model = instantiateTemplate("ai-saas", "m_dbg");
    const tools = createCopilotTools({ getModel: () => model, commit: (n) => { model = n; }, runMonteCarlo: async (o, s) => runMonteCarlo(model, { ...o, scenarioId: s ?? undefined }) });
    const provider = new OllamaProvider({ model: "gpt-oss:20b", timeoutMs: 300_000 });
    const r = await runAgent({ provider, tools, maxSteps: 10, model: "gpt-oss:20b", messages: [{ role: "system", content: COPILOT_SYSTEM_PROMPT }, { role: "user", content: q }] as ChatMessage[] });
    for (const m of r.messages.slice(1)) console.log(m.role, JSON.stringify(m.content).slice(0, 300), m.toolCalls ? JSON.stringify(m.toolCalls).slice(0, 400) : "");
    console.log("FINAL:", JSON.stringify(r.final));
  }
}, 600_000);
