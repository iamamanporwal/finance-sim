import { createServerProvider, errorToResponseBody, handleComplete, readAIConfig } from "@fin/ai/server";

export const maxDuration = 300;

/**
 * Proxies one chat / tool-call / structured-output request to the configured
 * provider. The request is validated; the provider URL comes only from server
 * environment variables, so the browser cannot point the server elsewhere.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const provider = createServerProvider(readAIConfig(process.env));
    return Response.json(await handleComplete(provider, body));
  } catch (e) {
    const { status, body } = errorToResponseBody(e);
    return Response.json(body, { status });
  }
}
