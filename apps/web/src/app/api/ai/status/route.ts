import { createServerProvider, readAIConfig } from "@fin/ai/server";
import type { AIStatus } from "@fin/ai";

/** Reports whether the configured AI provider is reachable and which models it has. */
export async function GET() {
  const config = readAIConfig(process.env);
  const base: AIStatus = { enabled: config.enabled, provider: config.provider, reachable: false, baseUrl: config.baseUrl, defaultModel: config.defaultModel, models: [] };
  if (!config.enabled) return Response.json({ ...base, error: "AI is disabled on this deployment (AI_PROVIDER=disabled)." });
  try {
    const models = await createServerProvider(config).listModels();
    return Response.json({ ...base, reachable: true, models } satisfies AIStatus, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ...base, error: e instanceof Error ? e.message : String(e) } satisfies AIStatus, { headers: { "Cache-Control": "no-store" } });
  }
}
