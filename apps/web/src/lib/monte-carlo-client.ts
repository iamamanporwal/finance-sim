import type { Model } from "@fin/model-schema";
import type { MonteCarloOptions, MonteCarloResult } from "@fin/monte-carlo";
import type { WorkerRequest, WorkerResponse } from "@/workers/monte-carlo.worker";

export interface MonteCarloJob {
  promise: Promise<MonteCarloResult | null>;
  cancel(): void;
}

/** Starts a Monte Carlo run in a dedicated Web Worker. Resolves null when cancelled. */
export function startMonteCarlo(model: Model, options: MonteCarloOptions, onProgress: (done: number, total: number) => void): MonteCarloJob {
  const worker = new Worker(new URL("../workers/monte-carlo.worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  const promise = new Promise<MonteCarloResult | null>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress(msg.done, msg.total);
      else {
        settled = true;
        worker.terminate();
        if (msg.type === "result") resolve(msg.result);
        else if (msg.type === "cancelled") resolve(null);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      settled = true;
      worker.terminate();
      reject(new Error(e.message || "Monte Carlo worker failed to start."));
    };
  });
  worker.postMessage({ type: "start", model, options } satisfies WorkerRequest);
  return {
    promise,
    cancel() {
      if (!settled) worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
    },
  };
}
