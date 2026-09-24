"use client";

import type { Model, ModelValidationResult, Parameter, SimulationResult } from "@fin/model-schema";
import type { MonteCarloOptions, MonteCarloResult } from "@fin/monte-carlo";
import { runSensitivity, SimulationBlockedError, SimulationError, simulate, validateForSimulation, type SensitivityOptions, type SensitivityResult } from "@fin/simulation-engine";
import { create } from "zustand";
import * as ops from "@/lib/model-ops";
import { startMonteCarlo, type MonteCarloJob } from "@/lib/monte-carlo-client";
import { clearOverride, effectiveValue, setOverride } from "@/lib/scenario-ops";
import { findPreset } from "@/lib/presets";
import { saveModel } from "@/lib/storage";

export type Mode = "build" | "simulate" | "results" | "report";
export type ResultsTab = "overview" | "scenarios" | "risk" | "sensitivity" | "guardrails";

export interface MonteCarloState {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  result: MonteCarloResult | null;
  error: string | null;
  /** Model and scenario the result was computed for (to flag stale results). */
  model: Model | null;
  scenarioId: string | null;
}

export interface ChangeTracker {
  parameterId: string;
  parameterName: string;
  unit: string;
  from: number;
  /** Result before the edit began — the "before" side of What changed?. */
  baseline: SimulationResult;
}

type SimStatus = "idle" | "ok" | "blocked" | "error";

interface EditorState {
  model: Model | null;
  past: Model[];
  future: Model[];
  selectedNodes: string[];
  selectedEdges: string[];
  clipboard: ops.Fragment | null;
  mode: Mode;
  resultsTab: ResultsTab;
  paletteOpen: boolean;
  /** Scenario whose overrides apply; edits to assumptions are stored as overrides while one is active. */
  activeScenarioId: string | null;
  monteCarlo: MonteCarloState;
  sensitivity: { result: SensitivityResult | null; options: SensitivityOptions | null; error: string | null; model: Model | null };
  validation: ModelValidationResult | null;

  result: SimulationResult | null;
  simStatus: SimStatus;
  simError: { message: string; nodeId?: string; period?: number } | null;
  /** True when the model changed since the displayed result was produced. */
  stale: boolean;
  lastRunMs: number | null;
  change: ChangeTracker | null;
  selectedPeriod: number | null;

  saveState: { dirty: boolean; savedAt: string | null; error: string | null };
  notice: { message: string; severity: "info" | "success" | "warning" | "error" } | null;

  load(model: Model): void;
  apply(fn: (m: Model) => Model, opts?: { record?: boolean; structural?: boolean }): void;
  /** Snapshot for a continuous gesture (drag) so it undoes as one step. */
  beginGesture(): void;
  undo(): void;
  redo(): void;
  run(): void;
  save(): void;

  addPreset(presetId: string, position: ops.XY): void;
  connect(req: ops.ConnectRequest): void;
  deleteSelection(): void;
  copySelection(): void;
  paste(): void;
  duplicateSelection(): void;
  setParameterValue(parameterId: string, value: number, extra?: Partial<Omit<Parameter, "id" | "value">>): void;
  updateParameter(parameterId: string, patch: Partial<Omit<Parameter, "id">>): void;

  resetOverride(parameterId: string): void;
  setActiveScenario(id: string | null): void;
  runMonteCarlo(options: MonteCarloOptions): Promise<MonteCarloResult | null>;
  cancelMonteCarlo(): void;
  runSensitivity(options: SensitivityOptions): SensitivityResult | null;

  select(nodes: string[], edges?: string[]): void;
  setMode(mode: Mode): void;
  setResultsTab(tab: ResultsTab): void;
  setPaletteOpen(open: boolean): void;
  setSelectedPeriod(period: number | null): void;
  notify(message: string, severity?: "info" | "success" | "warning" | "error"): void;
  clearNotice(): void;
}

const HISTORY_LIMIT = 100;
let runTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let mcJob: MonteCarloJob | null = null;
const IDLE_MC: MonteCarloState = { status: "idle", done: 0, total: 0, result: null, error: null, model: null, scenarioId: null };

export const useEditor = create<EditorState>((set, get) => {
  const scheduleRun = () => {
    clearTimeout(runTimer);
    runTimer = setTimeout(() => get().run(), 150);
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => get().save(), 800);
  };

  return {
    model: null,
    past: [],
    future: [],
    selectedNodes: [],
    selectedEdges: [],
    clipboard: null,
    mode: "build",
    resultsTab: "overview",
    paletteOpen: false,
    activeScenarioId: null,
    monteCarlo: IDLE_MC,
    sensitivity: { result: null, options: null, error: null, model: null },
    validation: null,
    result: null,
    simStatus: "idle",
    simError: null,
    stale: false,
    lastRunMs: null,
    change: null,
    selectedPeriod: null,
    saveState: { dirty: false, savedAt: null, error: null },
    notice: null,

    load(model) {
      set({
        model,
        past: [],
        future: [],
        selectedNodes: [],
        selectedEdges: [],
        validation: validateForSimulation(model),
        result: null,
        change: null,
        simStatus: "idle",
        selectedPeriod: null,
        activeScenarioId: null,
        monteCarlo: IDLE_MC,
        sensitivity: { result: null, options: null, error: null, model: null },
        saveState: { dirty: false, savedAt: model.metadata.updatedAt ?? null, error: null },
      });
      get().run();
    },

    apply(fn, { record = true, structural = true } = {}) {
      const { model, past } = get();
      if (!model) return;
      const next = fn(model);
      if (next === model) return;
      set({
        model: next,
        past: record ? [...past, model].slice(-HISTORY_LIMIT) : past,
        future: record ? [] : get().future,
        saveState: { ...get().saveState, dirty: true },
        ...(structural ? { validation: validateForSimulation(next), stale: true } : {}),
      });
      scheduleSave();
      if (structural) scheduleRun();
    },

    beginGesture() {
      const { model, past } = get();
      if (model) set({ past: [...past, model].slice(-HISTORY_LIMIT), future: [] });
    },

    undo() {
      const { past, model, future } = get();
      const prev = past[past.length - 1];
      if (!prev || !model) return;
      set({ model: prev, past: past.slice(0, -1), future: [model, ...future], validation: validateForSimulation(prev), stale: true, change: null });
      scheduleSave();
      scheduleRun();
    },

    redo() {
      const { past, model, future } = get();
      const next = future[0];
      if (!next || !model) return;
      set({ model: next, past: [...past, model], future: future.slice(1), validation: validateForSimulation(next), stale: true, change: null });
      scheduleSave();
      scheduleRun();
    },

    run() {
      clearTimeout(runTimer);
      const { model } = get();
      if (!model) return;
      const validation = validateForSimulation(model);
      if (!validation.valid) {
        set({ validation, simStatus: "blocked", simError: null, stale: get().result !== null });
        return;
      }
      let scenarioId = get().activeScenarioId;
      if (scenarioId && !model.scenarios.some((s) => s.id === scenarioId)) {
        scenarioId = null;
        set({ activeScenarioId: null });
      }
      const started = performance.now();
      try {
        const result = simulate(model, scenarioId ? { scenarioId } : {});
        const period = get().selectedPeriod;
        set({
          validation,
          result,
          simStatus: "ok",
          simError: null,
          stale: false,
          lastRunMs: performance.now() - started,
          selectedPeriod: period !== null && period <= result.timeline.length ? period : null,
        });
      } catch (e) {
        if (e instanceof SimulationError) {
          set({ simStatus: "error", simError: { message: `${e.message} (period ${e.period})`, nodeId: e.nodeId, period: e.period }, stale: get().result !== null });
        } else if (e instanceof SimulationBlockedError) {
          set({ simStatus: "blocked", simError: null, validation: { valid: false, model, issues: e.issues } });
        } else {
          set({ simStatus: "error", simError: { message: e instanceof Error ? e.message : String(e) } });
        }
      }
    },

    save() {
      clearTimeout(saveTimer);
      const { model } = get();
      if (!model) return;
      const { ok, savedAt } = saveModel(model);
      set({ saveState: ok ? { dirty: false, savedAt, error: null } : { ...get().saveState, error: "Could not save — browser storage is unavailable or full." } });
    },

    addPreset(presetId, position) {
      const preset = findPreset(presetId);
      if (!preset || !get().model) return;
      let nodeId = "";
      get().apply((m) => {
        const r = ops.addNode(m, preset, position);
        nodeId = r.nodeId;
        return r.model;
      });
      set({ selectedNodes: [nodeId], selectedEdges: [], change: null });
    },

    connect(req) {
      const model = get().model;
      if (!model) return;
      const check = ops.canConnect(model, req);
      if (!check.ok) {
        get().notify(check.reason, "warning");
        return;
      }
      get().apply((m) => ops.connect(m, req));
      set({ change: null });
    },

    deleteSelection() {
      const { selectedNodes, selectedEdges } = get();
      if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
      get().apply((m) => ops.removeElements(m, selectedNodes, selectedEdges));
      set({ selectedNodes: [], selectedEdges: [], change: null });
    },

    copySelection() {
      const { model, selectedNodes } = get();
      if (!model || selectedNodes.length === 0) return;
      set({ clipboard: ops.copyFragment(model, selectedNodes) });
      get().notify(`Copied ${selectedNodes.length} node${selectedNodes.length === 1 ? "" : "s"}.`, "info");
    },

    paste() {
      const { clipboard } = get();
      if (!clipboard || clipboard.nodes.length === 0) return;
      let ids: string[] = [];
      get().apply((m) => {
        const r = ops.pasteFragment(m, clipboard);
        ids = r.nodeIds;
        return r.model;
      });
      // Shift the clipboard so repeated pastes cascade instead of stacking.
      set({
        selectedNodes: ids,
        selectedEdges: [],
        change: null,
        clipboard: { ...clipboard, nodes: clipboard.nodes.map((n) => ({ ...n, position: { x: n.position.x + 40, y: n.position.y + 40 } })) },
      });
    },

    duplicateSelection() {
      const { model, selectedNodes } = get();
      if (!model || selectedNodes.length === 0) return;
      let ids: string[] = [];
      get().apply((m) => {
        const r = ops.pasteFragment(m, ops.copyFragment(m, selectedNodes));
        ids = r.nodeIds;
        return r.model;
      });
      set({ selectedNodes: ids, selectedEdges: [], change: null });
    },

    setParameterValue(parameterId, value, extra = {}) {
      const { model, result, change, activeScenarioId } = get();
      const param = model?.parameters.find((p) => p.id === parameterId);
      if (!model || !param || !Number.isFinite(value)) return;
      const current = effectiveValue(model, activeScenarioId, parameterId);
      if (current === value) return;
      if (result && change?.parameterId !== parameterId) {
        set({ change: { parameterId, parameterName: param.name, unit: param.unit, from: current, baseline: result } });
      }
      if (activeScenarioId) {
        // Scenarios only store overrides: the base model is left untouched.
        get().apply((m) => setOverride(m, activeScenarioId, parameterId, value));
      } else {
        get().apply((m) => ops.updateParameter(m, parameterId, { ...extra, value, source: "user", status: "accepted" }));
      }
    },

    resetOverride(parameterId) {
      const sid = get().activeScenarioId;
      if (sid) get().apply((m) => clearOverride(m, sid, parameterId));
    },

    setActiveScenario(id) {
      if (get().activeScenarioId === id) return;
      set({ activeScenarioId: id, change: null, stale: true });
      get().run();
    },

    async runMonteCarlo(options) {
      const { model, activeScenarioId } = get();
      if (!model) return null;
      mcJob?.cancel();
      const scenarioId = activeScenarioId;
      set({ monteCarlo: { status: "running", done: 0, total: options.runs, result: get().monteCarlo.result, error: null, model, scenarioId } });
      const job = startMonteCarlo(model, { ...options, scenarioId: scenarioId ?? undefined }, (done, total) =>
        set((s) => ({ monteCarlo: { ...s.monteCarlo, done, total } })),
      );
      mcJob = job;
      try {
        const result = await job.promise;
        if (mcJob !== job) return null;
        set((s) => ({ monteCarlo: result ? { ...s.monteCarlo, status: "done", result } : { ...s.monteCarlo, status: s.monteCarlo.result ? "done" : "idle" } }));
        return result;
      } catch (e) {
        set((s) => ({ monteCarlo: { ...s.monteCarlo, status: "error", error: e instanceof Error ? e.message : String(e) } }));
        return null;
      } finally {
        if (mcJob === job) mcJob = null;
      }
    },

    cancelMonteCarlo() {
      mcJob?.cancel();
    },

    runSensitivity(options) {
      const { model, activeScenarioId } = get();
      if (!model) return null;
      try {
        const result = runSensitivity(model, { ...options, scenarioId: activeScenarioId ?? undefined });
        set({ sensitivity: { result, options, error: null, model } });
        return result;
      } catch (e) {
        set({ sensitivity: { result: null, options, error: e instanceof Error ? e.message : String(e), model } });
        return null;
      }
    },

    updateParameter(parameterId, patch) {
      get().apply((m) => ops.updateParameter(m, parameterId, patch));
    },

    select(nodes, edges = []) {
      const s = get();
      if (sameList(s.selectedNodes, nodes) && sameList(s.selectedEdges, edges)) return;
      set({ selectedNodes: nodes, selectedEdges: edges });
    },
    setMode: (mode) => set({ mode }),
    setResultsTab: (resultsTab) => set({ resultsTab, mode: "results" }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setSelectedPeriod: (selectedPeriod) => set({ selectedPeriod }),
    notify: (message, severity = "info") => set({ notice: { message, severity } }),
    clearNotice: () => set({ notice: null }),
  };
});

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
