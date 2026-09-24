import { type Model } from "@fin/model-schema";

export interface ReviewItem {
  ok: boolean;
  label: string;
  hint?: string;
}

export interface ModelReview {
  items: ReviewItem[];
  pendingAssumptions: number;
  confidence: "High" | "Medium" | "Low";
}

/**
 * Deterministic model review (no AI): which parts of a business model are
 * present, and how much of it rests on unreviewed AI suggestions.
 */
export function reviewModel(model: Model): ModelReview {
  const has = (pred: (n: Model["nodes"][number]) => boolean) => model.nodes.some(pred);
  const params = new Map(model.parameters.map((p) => [p.id, p]));
  const valueOf = (pid: string | undefined) => (pid ? params.get(pid)?.value : undefined);
  const connectedTo = (nodeId: string, port: string) => model.connections.some((c) => c.target === nodeId && c.targetPort === port);

  const customerNodes = model.nodes.filter((n) => n.type === "CUSTOMERS");
  const items: ReviewItem[] = [
    { ok: has((n) => n.type === "REVENUE"), label: "Revenue model defined", hint: "Add a Subscription or Usage revenue node." },
    {
      ok: customerNodes.some((n) => connectedTo(n.id, "new")) || has((n) => n.type === "ACQUISITION"),
      label: "Customer acquisition defined",
      hint: "Connect signups → conversion → customers, or add Acquisition.",
    },
    {
      ok: customerNodes.some((n) => connectedTo(n.id, "churnRate") || (valueOf(n.parameters.churnRate) ?? 0) > 0),
      label: "Churn defined",
      hint: "Add a Churn node and connect it to Customers.",
    },
    { ok: has((n) => n.type === "COST" && n.config.costClass === "cogs"), label: "Variable costs defined", hint: "Add a Variable Cost for the cost to serve each customer." },
    { ok: has((n) => n.type === "COST" && n.config.costClass === "opex"), label: "Payroll or fixed costs defined", hint: "Add a Fixed Cost for salaries, rent and software." },
    {
      ok: model.nodes.some((n) => n.type === "CASH" && (valueOf(n.parameters.initial) ?? 0) > 0),
      label: "Starting cash defined",
      hint: "Add a Cash node with your current bank balance.",
    },
    { ok: has((n) => n.type === "COST" && n.config.category === "payment"), label: "Payment processing defined", hint: "Add a Percentage Cost (e.g. 2.9% of revenue)." },
  ];
  const used = new Set(model.nodes.flatMap((n) => Object.values(n.parameters)));
  const pendingAssumptions = model.parameters.filter((p) => used.has(p.id) && p.status === "pending").length;
  const missing = items.filter((i) => !i.ok).length;
  const confidence = missing === 0 && pendingAssumptions === 0 ? "High" : missing <= 2 && pendingAssumptions <= 3 ? "Medium" : "Low";
  return { items, pendingAssumptions, confidence };
}
