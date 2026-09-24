import { findOutput, type Model } from "@fin/model-schema";

export interface DependencyEdge {
  connectionId: string;
  from: string;
  to: string;
  /**
   * Lagged edges read a value known at the start of the period (a stock's
   * opening balance). They carry influence forward in time but impose no
   * same-period ordering, so they never form a circular dependency.
   */
  lagged: boolean;
}

export class CircularDependencyError extends Error {
  constructor(readonly cycle: string[], labels: string[]) {
    super(`Circular dependency detected. ${labels.join(" → ")}`);
    this.name = "CircularDependencyError";
  }
}

/**
 * Which nodes depend on which. Used for execution order (topological sort),
 * cycle detection and incremental recalculation (downstream invalidation).
 */
export class DependencyGraph {
  readonly nodeIds: readonly string[];
  private readonly order = new Map<string, number>();
  private readonly outgoing = new Map<string, DependencyEdge[]>();
  private readonly incoming = new Map<string, DependencyEdge[]>();
  private readonly labels = new Map<string, string>();

  constructor(nodeIds: readonly string[], edges: readonly DependencyEdge[], labels?: ReadonlyMap<string, string>) {
    this.nodeIds = nodeIds;
    nodeIds.forEach((id, i) => {
      this.order.set(id, i);
      this.outgoing.set(id, []);
      this.incoming.set(id, []);
    });
    for (const e of edges) {
      if (!this.order.has(e.from) || !this.order.has(e.to)) continue;
      this.outgoing.get(e.from)!.push(e);
      this.incoming.get(e.to)!.push(e);
    }
    labels?.forEach((v, k) => this.labels.set(k, v));
  }

  static fromModel(model: Pick<Model, "nodes" | "connections">): DependencyGraph {
    const nodes = new Map(model.nodes.map((n) => [n.id, n]));
    const edges: DependencyEdge[] = model.connections.map((c) => {
      const source = nodes.get(c.source);
      return {
        connectionId: c.id,
        from: c.source,
        to: c.target,
        lagged: source ? findOutput(source, c.sourcePort)?.lagged === true : false,
      };
    });
    return new DependencyGraph(
      model.nodes.map((n) => n.id),
      edges,
      new Map(model.nodes.map((n) => [n.id, n.label])),
    );
  }

  dependenciesOf(id: string, includeLagged = true): string[] {
    return unique((this.incoming.get(id) ?? []).filter((e) => includeLagged || !e.lagged).map((e) => e.from));
  }

  dependentsOf(id: string, includeLagged = true): string[] {
    return unique((this.outgoing.get(id) ?? []).filter((e) => includeLagged || !e.lagged).map((e) => e.to));
  }

  /**
   * Returns a cycle over same-period (non-lagged) edges as [A, B, C, A],
   * or null when the graph is acyclic.
   */
  findCycle(): string[] | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(this.nodeIds.map((id) => [id, WHITE]));
    const stack: string[] = [];

    const visit = (id: string): string[] | null => {
      color.set(id, GRAY);
      stack.push(id);
      for (const next of this.dependentsOf(id, false)) {
        const c = color.get(next);
        if (c === GRAY) return [...stack.slice(stack.indexOf(next)), next];
        if (c === WHITE) {
          const found = visit(next);
          if (found) return found;
        }
      }
      stack.pop();
      color.set(id, BLACK);
      return null;
    };

    for (const id of this.nodeIds) {
      if (color.get(id) === WHITE) {
        const cycle = visit(id);
        if (cycle) return cycle;
      }
    }
    return null;
  }

  /**
   * Deterministic topological order over same-period edges (Kahn's algorithm;
   * ties broken by the node's position in the model). Throws on cycles.
   */
  topologicalOrder(): string[] {
    const indegree = new Map<string, number>(this.nodeIds.map((id) => [id, this.dependenciesOf(id, false).length]));
    const ready = this.nodeIds.filter((id) => indegree.get(id) === 0);
    const result: string[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      result.push(id);
      for (const next of this.dependentsOf(id, false)) {
        const d = indegree.get(next)! - 1;
        indegree.set(next, d);
        if (d === 0) insertSorted(ready, next, this.order);
      }
    }
    if (result.length !== this.nodeIds.length) {
      const cycle = this.findCycle() ?? [];
      throw new CircularDependencyError(cycle, cycle.map((id) => this.labels.get(id) ?? id));
    }
    return result;
  }

  /** The given nodes plus everything that depends on them, directly or transitively (including across periods). */
  downstreamOf(ids: Iterable<string>): Set<string> {
    return this.reach(ids, (id) => this.dependentsOf(id));
  }

  /** The given nodes plus everything they depend on (used to explain "Why?"). */
  upstreamOf(ids: Iterable<string>): Set<string> {
    return this.reach(ids, (id) => this.dependenciesOf(id));
  }

  labelOf(id: string): string {
    return this.labels.get(id) ?? id;
  }

  private reach(start: Iterable<string>, next: (id: string) => string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...start].filter((id) => this.order.has(id));
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...next(id));
    }
    return seen;
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function insertSorted(list: string[], id: string, order: Map<string, number>) {
  const rank = order.get(id)!;
  let i = list.length;
  while (i > 0 && order.get(list[i - 1]!)! > rank) i--;
  list.splice(i, 0, id);
}
