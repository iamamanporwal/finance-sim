/// <reference lib="webworker" />
/**
 * Monte Carlo runs off the main thread. Work is chunked so progress can be
 * reported and a cancel message can be handled between chunks.
 */
import { MonteCarloRun, type MonteCarloOptions } from "@fin/monte-carlo";

export type WorkerRequest = { type: "start"; model: unknown; options: MonteCarloOptions } | { type: "cancel" };
export type WorkerResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: ReturnType<MonteCarloRun["result"]> }
  | { type: "cancelled" }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let cancelled = false;
const post = (msg: WorkerResponse) => ctx.postMessage(msg);

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    const run = new MonteCarloRun(msg.model, msg.options);
    const chunk = Math.max(10, Math.ceil(msg.options.runs / 100));
    while (!run.done) {
      if (cancelled) {
        post({ type: "cancelled" });
        return;
      }
      run.step(chunk);
      post({ type: "progress", done: run.completed, total: msg.options.runs });
      // Yield so a cancel message can be processed.
      await new Promise((r) => setTimeout(r, 0));
    }
    post({ type: "result", result: run.result() });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
