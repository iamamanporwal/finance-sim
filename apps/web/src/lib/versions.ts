/**
 * Model versioning. Every version is an immutable snapshot (graph, parameters,
 * scenarios, settings and seed), so any result can be reproduced from it.
 * Storage is abstracted so the logic is testable and can move to a database.
 */
import { diffModels, ModelVersionSchema, type Model, type ModelVersion, type SimulationSummary } from "@fin/model-schema";
import { newId } from "./ids";

export interface VersionStore {
  read(modelId: string): ModelVersion[];
  write(modelId: string, versions: ModelVersion[]): boolean;
}

/** Most versions kept per model; automatic versions are pruned first. */
export const MAX_VERSIONS = 40;
/** Autosave creates a version at most this often (explicit saves always do). */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;

export function latestVersion(versions: readonly ModelVersion[]): ModelVersion | undefined {
  return versions.reduce<ModelVersion | undefined>((m, v) => (!m || v.version > m.version ? v : m), undefined);
}

export type CreateVersionResult = { status: "created"; model: Model; version: ModelVersion } | { status: "unchanged"; version: ModelVersion } | { status: "skipped" } | { status: "failed" };

/**
 * Creates a version when the model differs from the latest one. Returns the
 * working model with its version number bumped to the new version.
 */
export function createVersion(
  store: VersionStore,
  model: Model,
  opts: { kind: ModelVersion["kind"]; label?: string; summary?: SimulationSummary | null; now?: Date },
): CreateVersionResult {
  const now = opts.now ?? new Date();
  const versions = store.read(model.id);
  const latest = latestVersion(versions);
  if (latest && diffModels(latest.snapshot, model).identical) {
    return opts.kind === "auto" ? { status: "skipped" } : { status: "unchanged", version: latest };
  }
  if (opts.kind === "auto" && latest && now.getTime() - Date.parse(latest.createdAt) < AUTO_VERSION_INTERVAL_MS) return { status: "skipped" };
  const number = (latest?.version ?? 0) + 1;
  const snapshot: Model = structuredClone({ ...model, version: number });
  const version: ModelVersion = { id: newId("v"), modelId: model.id, version: number, createdAt: now.toISOString(), kind: opts.kind, label: opts.label?.trim() || undefined, snapshot, summary: opts.summary ?? null };
  const next = prune([...versions, version]);
  if (!store.write(model.id, next)) {
    // Storage full: drop old automatic versions harder and retry once.
    if (!store.write(model.id, prune(next, Math.floor(MAX_VERSIONS / 2)))) return { status: "failed" };
  }
  return { status: "created", model: { ...model, version: number }, version };
}

function prune(versions: ModelVersion[], max = MAX_VERSIONS): ModelVersion[] {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  while (sorted.length > max) {
    // Never drop the newest; prefer the oldest automatic version.
    const auto = sorted.slice(0, -1).findIndex((v) => v.kind === "auto");
    sorted.splice(auto >= 0 ? auto : 0, 1);
  }
  return sorted;
}

/** The version's content under the current model's identity; the caller records it as a new "restore" version. */
export function restoreSnapshot(current: Model, v: ModelVersion): Model {
  return { ...structuredClone(v.snapshot), id: current.id, name: current.name, version: current.version, metadata: { ...v.snapshot.metadata, createdAt: current.metadata.createdAt } };
}

/** A new, independent model from a version. */
export function duplicateFromVersion(v: ModelVersion, id: string = newId("m")): Model {
  return { ...structuredClone(v.snapshot), id, name: `${v.snapshot.name} (v${v.version} copy)`, version: 1, metadata: { ...v.snapshot.metadata, createdAt: new Date().toISOString(), updatedAt: undefined } };
}

export function parseVersions(raw: unknown): ModelVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = ModelVersionSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

/** In-memory store (tests, and the fallback when browser storage is unavailable). */
export function memoryVersionStore(): VersionStore {
  const data = new Map<string, ModelVersion[]>();
  return { read: (id) => data.get(id) ?? [], write: (id, v) => (data.set(id, v), true) };
}
