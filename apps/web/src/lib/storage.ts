/**
 * Browser persistence for models (V1: no database yet). Every access is
 * wrapped: storage can be unavailable (private mode, blocked site data).
 */
import { ModelSchema, type Model, type ModelVersion } from "@fin/model-schema";
import { parseVersions, type VersionStore } from "./versions";

const INDEX_KEY = "fin:models";
const modelKey = (id: string) => `fin:model:${id}`;
const versionsKey = (id: string) => `fin:versions:${id}`;

export interface ModelSummary {
  id: string;
  name: string;
  updatedAt: string;
  nodeCount: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listModels(): ModelSummary[] {
  return (read<ModelSummary[]>(INDEX_KEY) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Returns the stored model, or null when missing or no longer schema-valid. */
export function loadModel(id: string): Model | null {
  const raw = read<unknown>(modelKey(id));
  if (!raw) return null;
  const parsed = ModelSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function saveModel(model: Model): { ok: boolean; savedAt: string } {
  const savedAt = new Date().toISOString();
  const stored = { ...model, metadata: { ...model.metadata, updatedAt: savedAt } };
  const ok = write(modelKey(model.id), stored);
  if (ok) {
    const index = listModels().filter((m) => m.id !== model.id);
    write(INDEX_KEY, [{ id: model.id, name: model.name, updatedAt: savedAt, nodeCount: model.nodes.length }, ...index]);
  }
  return { ok, savedAt };
}

/** Version history in browser storage. */
export const browserVersionStore: VersionStore = {
  read: (id) => parseVersions(read<unknown>(versionsKey(id))),
  write: (id, versions: ModelVersion[]) => write(versionsKey(id), versions),
};

export function deleteModel(id: string): void {
  try {
    window.localStorage.removeItem(modelKey(id));
    window.localStorage.removeItem(versionsKey(id));
  } catch {
    // ignore
  }
  write(INDEX_KEY, listModels().filter((m) => m.id !== id));
}
