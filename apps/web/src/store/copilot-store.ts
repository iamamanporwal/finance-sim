"use client";

import { AIProviderError, runAgent, type AgentEvent, type ChatMessage } from "@fin/ai";
import { create } from "zustand";
import { requiresTools, TOOL_NUDGE } from "@/ai/intent";
import { COPILOT_SYSTEM_PROMPT } from "@/ai/prompts";
import { createCopilotTools } from "@/ai/tools";
import { createProvider, effectiveModel } from "@/lib/ai-client";
import { useEditor } from "./editor-store";

export type CopilotItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown>; ok?: boolean; result?: unknown }
  | { kind: "error"; text: string };

interface CopilotState {
  open: boolean;
  running: boolean;
  items: CopilotItem[];
  history: ChatMessage[];
  setOpen(open: boolean): void;
  send(text: string): Promise<void>;
  stop(): void;
  clear(): void;
}

const MAX_HISTORY = 40;
let controller: AbortController | null = null;

export const useCopilot = create<CopilotState>((set, get) => ({
  open: false,
  running: false,
  items: [],
  history: [],
  setOpen: (open) => set({ open }),
  clear: () => set({ items: [], history: [] }),
  stop: () => controller?.abort(),

  async send(text) {
    const editor = useEditor.getState();
    if (!editor.model || get().running || !text.trim()) return;
    controller = new AbortController();
    set((s) => ({ running: true, items: [...s.items, { kind: "user", text }] }));

    // Tools act only through validated, undoable editor operations.
    const tools = createCopilotTools({
      getModel: () => useEditor.getState().model!,
      commit: (next, summary) => {
        useEditor.getState().apply(() => next);
        useEditor.getState().notify(summary, "info");
      },
      runMonteCarlo: (o, scenarioId) => useEditor.getState().runMonteCarlo(o, scenarioId),
    });
    const m = editor.model;
    const scenario = m.scenarios.find((s) => s.id === editor.activeScenarioId);
    const context = `Current model: "${m.name}", ${m.nodes.length} nodes, ${m.settings.horizon} ${m.settings.timeStep} periods from ${m.settings.startDate}, currency ${m.settings.currency}.${scenario ? ` The user is viewing scenario "${scenario.name}" (${scenario.id}).` : ""}`;
    const user: ChatMessage = { role: "user", content: text };
    try {
      // Same model resolution as everywhere else: saved choice → server default → first installed.
      const provider = createProvider();
      const model = effectiveModel(await provider.status());
      if (!model) throw new Error("No local AI model is available. Open AI settings to check the connection.");
      const onEvent = (e: AgentEvent) => {
          if (e.type === "tool-call") set((s) => ({ items: [...s.items, { kind: "tool", name: e.call.name, args: e.call.arguments }] }));
          if (e.type === "tool-result")
            set((s) => {
              const items = [...s.items];
              for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i]!;
                if (it.kind === "tool" && it.name === e.run.call.name && it.ok === undefined) {
                  items[i] = { ...it, ok: e.run.ok, result: e.run.result };
                  break;
                }
              }
              return { items };
            });
      };
      let r = await runAgent({
        provider,
        model,
        tools,
        signal: controller.signal,
        maxSteps: 10,
        messages: [{ role: "system", content: `${COPILOT_SYSTEM_PROMPT}\n\n${context}` }, ...get().history, user],
        onEvent,
      });
      // "Do not just answer conversationally": a what-if or change must be executed with tools.
      if (r.toolRuns.length === 0 && requiresTools(text)) {
        r = await runAgent({ provider, model, tools, signal: controller.signal, maxSteps: 10, messages: [...r.messages, { role: "user", content: TOOL_NUDGE }], onEvent });
      }
      set((s) => ({
        items: r.final ? [...s.items, { kind: "assistant", text: r.final }] : s.items,
        // Keep the conversation (without the system prompt) for follow-up questions.
        history: r.messages.filter((x) => x.role !== "system" && x.content !== TOOL_NUDGE).slice(-MAX_HISTORY),
      }));
    } catch (e) {
      const message = controller?.signal.aborted ? "Stopped." : e instanceof AIProviderError || e instanceof Error ? e.message : String(e);
      set((s) => ({ items: [...s.items, { kind: "error", text: message }], history: [...s.history, user].slice(-MAX_HISTORY) }));
    } finally {
      controller = null;
      set({ running: false });
    }
  },
}));
