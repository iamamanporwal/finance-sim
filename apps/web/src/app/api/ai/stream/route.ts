import { AIStreamRequestSchema, createServerProvider, errorToResponseBody, readAIConfig } from "@fin/ai/server";

export const maxDuration = 300;

/** Streams plain text tokens from the provider. */
export async function POST(request: Request) {
  try {
    const req = AIStreamRequestSchema.parse(await request.json());
    const provider = createServerProvider(readAIConfig(process.env));
    const iterator = provider.stream({ messages: req.messages, model: req.model, temperature: req.temperature, signal: request.signal })[Symbol.asyncIterator]();
    // Pull the first chunk before responding so connection errors become proper HTTP errors.
    const first = await iterator.next();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!first.done) controller.enqueue(encoder.encode(first.value));
      },
      async pull(controller) {
        try {
          const { done, value } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch (e) {
          controller.error(e);
        }
      },
      cancel() {
        void iterator.return?.();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    const { status, body } = errorToResponseBody(e);
    return Response.json(body, { status });
  }
}
