/**
 * Accept / reject for AI-suggested assumptions. Rejecting never leaves an
 * invented number silently in place: the assumption is removed, falls back to
 * its documented default, or is marked rejected (which blocks simulation until
 * the user enters their own value).
 */
import { findSlot, NODE_CATALOG, type Model } from "@fin/model-schema";
import * as ops from "./model-ops";

export function pendingAssumptions(model: Model) {
  const used = new Set(model.nodes.flatMap((n) => Object.values(n.parameters)));
  return model.parameters.filter((p) => used.has(p.id) && p.status === "pending");
}

export function acceptAssumption(model: Model, parameterId: string): Model {
  return ops.updateParameter(model, parameterId, { status: "accepted" });
}

export function acceptAll(model: Model): Model {
  return { ...model, parameters: model.parameters.map((p) => (p.status === "pending" ? { ...p, status: "accepted" as const } : p)) };
}

export type RejectOutcome = "removed-node" | "default" | "marked-rejected";

export function rejectAssumption(model: Model, parameterId: string): { model: Model; outcome: RejectOutcome; nodeLabels: string[] } {
  const users = model.nodes.filter((n) => Object.values(n.parameters).includes(parameterId));
  const labels = users.map((n) => n.label);
  // An AI-created cost node that exists only for this assumption (e.g. "Payment fees") is removed entirely.
  const removable = users.length > 0 && users.every((n) => n.metadata?.source === "ai" && n.type === "COST" && Object.values(n.parameters).every((pid) => pid === parameterId));
  if (removable) return { model: ops.removeElements(model, users.map((n) => n.id)), outcome: "removed-node", nodeLabels: labels };
  // Optional inputs fall back to their documented default.
  const optional = users.every((n) =>
    Object.entries(n.parameters)
      .filter(([, pid]) => pid === parameterId)
      .every(([slot]) => {
        const spec = findSlot(n, slot);
        return !!spec && !spec.required && spec.default !== undefined;
      }),
  );
  if (users.length > 0 && optional) {
    let m = model;
    for (const n of users) for (const [slot, pid] of Object.entries(n.parameters)) if (pid === parameterId) m = ops.unbindParameter(m, n.id, slot);
    return { model: m, outcome: "default", nodeLabels: labels };
  }
  return { model: ops.updateParameter(model, parameterId, { status: "rejected" }), outcome: "marked-rejected", nodeLabels: labels };
}

export function describeRejection(outcome: RejectOutcome, name: string, nodes: string[]): string {
  switch (outcome) {
    case "removed-node":
      return `Removed ${nodes.join(", ")} (it only existed for “${name}”).`;
    case "default":
      return `“${name}” now uses the default value.`;
    case "marked-rejected":
      return `“${name}” is marked rejected. Enter your own value in ${nodes.join(", ")} before simulating.`;
  }
}

export const nodeTypeLabel = (m: Model, nodeId: string) => {
  const n = m.nodes.find((x) => x.id === nodeId);
  return n ? NODE_CATALOG[n.type].label : "";
};
