"use client";

import { ProxyProvider, type AIStatus } from "@fin/ai";
import { useCallback, useEffect, useState } from "react";

const MODEL_KEY = "fin:ai-model";

export function getSelectedModel(): string | undefined {
  try {
    return window.localStorage.getItem(MODEL_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function setSelectedModel(model: string | undefined): void {
  try {
    if (model) window.localStorage.setItem(MODEL_KEY, model);
    else window.localStorage.removeItem(MODEL_KEY);
  } catch {
    // storage unavailable: the server default model is used
  }
}

/** Browser provider: all calls go through the app's /api/ai routes. */
export function createProvider(): ProxyProvider {
  return new ProxyProvider({ model: getSelectedModel() });
}

/** Resolves which model will be used: the user's choice if installed, else the server default, else the first installed. */
export function effectiveModel(status: AIStatus | null): string | undefined {
  if (!status) return undefined;
  const chosen = getSelectedModel();
  if (chosen && status.models.some((m) => m.name === chosen)) return chosen;
  if (status.defaultModel) return status.defaultModel;
  return status.models[0]?.name;
}

export function useAIStatus() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await new ProxyProvider().status());
    } catch {
      setStatus({ enabled: false, provider: "ollama", reachable: false, models: [], error: "Could not reach the app server." });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, loading, refresh };
}
