import { acceptanceModel, diffModels, parseModel } from "@fin/model-schema";
import { simulate } from "@fin/simulation-engine";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/model-ops";
import { AUTO_VERSION_INTERVAL_MS, createVersion, duplicateFromVersion, MAX_VERSIONS, memoryVersionStore, restoreSnapshot } from "../src/lib/versions";

const model = parseModel(acceptanceModel());
const t0 = new Date("2026-09-24T10:00:00Z");

describe("model versioning", () => {
  it("every save creates a version with the graph, parameters, scenarios, settings and seed", () => {
    const store = memoryVersionStore();
    const r = createVersion(store, model, { kind: "manual", label: "First", summary: simulate(model).summary, now: t0 });
    expect(r.status).toBe("created");
    if (r.status !== "created") return;
    expect(r.version.version).toBe(1);
    expect(r.model.version).toBe(1);
    expect(r.version.snapshot).toEqual({ ...model, version: 1 });
    expect(r.version.snapshot.settings.seed).toBe(42);
    // Saving again without changes does not create a duplicate.
    expect(createVersion(store, r.model, { kind: "manual", now: t0 }).status).toBe("unchanged");
    const edited = ops.updateParameter(r.model, "p_growth", { value: 0.15 });
    const r2 = createVersion(store, edited, { kind: "manual", now: t0 });
    expect(r2.status === "created" && r2.version.version).toBe(2);
    // The snapshot reproduces its results exactly.
    const v1 = store.read(model.id)[0]!;
    expect(simulate(v1.snapshot).summary).toEqual(v1.summary);
  });

  it("autosave versions at most every 10 minutes", () => {
    const store = memoryVersionStore();
    createVersion(store, model, { kind: "auto", now: t0 });
    const edited = ops.updateParameter(model, "p_price", { value: 49 });
    expect(createVersion(store, edited, { kind: "auto", now: new Date(t0.getTime() + 60_000) }).status).toBe("skipped");
    expect(createVersion(store, edited, { kind: "auto", now: new Date(t0.getTime() + AUTO_VERSION_INTERVAL_MS) }).status).toBe("created");
  });

  it("keeps at most MAX_VERSIONS, pruning automatic versions first", () => {
    const store = memoryVersionStore();
    let m = model;
    for (let i = 0; i < MAX_VERSIONS + 5; i++) {
      m = ops.updateParameter(m, "p_price", { value: 40 + i });
      const r = createVersion(store, m, { kind: i === 0 ? "manual" : "auto", now: new Date(t0.getTime() + i * AUTO_VERSION_INTERVAL_MS) });
      if (r.status === "created") m = r.model;
    }
    const versions = store.read(model.id);
    expect(versions.length).toBe(MAX_VERSIONS);
    expect(versions[0]!.kind).toBe("manual");
    expect(versions[versions.length - 1]!.version).toBe(MAX_VERSIONS + 5);
  });

  it("compares versions: v1 → v2 lists changed assumptions", () => {
    const v2 = ops.updateParameter(ops.updateParameter(ops.updateParameter(model, "p_growth", { value: 0.15 }), "p_price", { value: 49 }), "p_churn", { value: 0.06 });
    const d = diffModels(model, v2);
    expect(d.parameters.changed.map((c) => [c.name, c.from, c.to])).toEqual([
      ["Signup growth", 0.2, 0.15],
      ["Price", 39, 49],
      ["Monthly churn", 0.05, 0.06],
    ]);
    expect(d.identical).toBe(false);
    const moved = { ...model, nodes: model.nodes.map((n) => ({ ...n, position: { x: n.position.x + 10, y: 0 } })) };
    expect(diffModels(model, moved).identical).toBe(true);
    const removed = ops.removeElements(model, ["fixed"]);
    expect(diffModels(model, removed)).toMatchObject({ nodes: { removed: ["Fixed costs"] }, connections: { removed: 1 } });
  });

  it("restores and duplicates versions", () => {
    const store = memoryVersionStore();
    const r = createVersion(store, model, { kind: "manual", now: t0 });
    if (r.status !== "created") throw new Error("expected a version");
    const later = { ...ops.updateParameter(r.model, "p_price", { value: 99 }), name: "Renamed" };
    const restored = restoreSnapshot(later, r.version);
    expect(restored.parameters.find((p) => p.id === "p_price")!.value).toBe(39);
    expect(restored.name).toBe("Renamed");
    const copy = duplicateFromVersion(r.version, "m_copy");
    expect(copy).toMatchObject({ id: "m_copy", name: "Acceptance model (v1 copy)", version: 1 });
  });
});
