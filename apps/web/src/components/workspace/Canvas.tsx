"use client";

import { findOutput } from "@fin/model-schema";
import { DependencyGraph } from "@fin/simulation-engine";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection as RFConnection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { canConnect, moveNodes } from "@/lib/model-ops";
import { useEditor } from "@/store/editor-store";
import { categoryColors, tokens } from "@/theme/theme";
import { NODE_CATALOG } from "@fin/model-schema";
import { EmptyCanvas } from "./EmptyCanvas";
import { FinanceNode, type FinanceNodeData } from "./FinanceNode";

const nodeTypes = { finance: FinanceNode };
export const PRESET_MIME = "application/x-fin-preset";

export function Canvas() {
  const model = useEditor((s) => s.model)!;
  const selectedNodes = useEditor((s) => s.selectedNodes);
  const selectedEdges = useEditor((s) => s.selectedEdges);
  const validation = useEditor((s) => s.validation);
  const { screenToFlowPosition } = useReactFlow();

  // Nodes in a circular dependency are highlighted.
  const cycleNodes = useMemo(() => {
    if (!validation?.issues.some((i) => i.code === "circular-dependency")) return new Set<string>();
    return new Set(DependencyGraph.fromModel(model).findCycle() ?? []);
  }, [validation, model]);

  // React Flow v12 keeps measured sizes on node objects, so nodes live in local
  // state (synced from the model) and dimension changes are applied locally.
  const [rfNodes, setRfNodes] = useState<Node<FinanceNodeData>[]>([]);
  useEffect(() => {
    const selected = new Set(selectedNodes);
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return model.nodes.map((n) => ({
        ...prevById.get(n.id),
        id: n.id,
        type: "finance",
        position: n.position,
        selected: selected.has(n.id),
        data: { inCycle: cycleNodes.has(n.id) },
      }));
    });
  }, [model.nodes, selectedNodes, cycleNodes]);

  const edges = useMemo<Edge[]>(() => {
    const selected = new Set(selectedEdges);
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    return model.connections.map((c) => {
      const source = byId.get(c.source);
      const lagged = source ? findOutput(source, c.sourcePort)?.lagged === true : false;
      const color = source ? categoryColors[NODE_CATALOG[source.type].category] : tokens.textSecondary;
      const isSel = selected.has(c.id);
      return {
        id: c.id,
        source: c.source,
        sourceHandle: c.sourcePort,
        target: c.target,
        targetHandle: c.targetPort,
        selected: isSel,
        animated: false,
        label: lagged ? "previous period" : undefined,
        labelStyle: { fontSize: 10, fill: tokens.textSecondary },
        style: { stroke: isSel ? tokens.primary : color, strokeWidth: isSel ? 2.5 : 1.5, strokeDasharray: lagged ? "5 4" : undefined, opacity: 0.85 },
        markerEnd: { type: MarkerType.ArrowClosed, color: isSel ? tokens.primary : color, width: 16, height: 16 },
      };
    });
  }, [model.connections, model.nodes, selectedEdges]);

  const onNodesChange = useCallback((changes: NodeChange<Node<FinanceNodeData>>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    const selectChanges = changes.filter((c) => c.type === "select");
    if (selectChanges.length > 0) {
      const { selectedNodes: current, selectedEdges: edgesSel, select } = useEditor.getState();
      const next = new Set(current);
      for (const c of selectChanges) {
        if (c.type !== "select") continue;
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      select([...next], edgesSel);
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const selectChanges = changes.filter((c) => c.type === "select");
    if (selectChanges.length === 0) return;
    const { selectedNodes: nodesSel, selectedEdges: current, select } = useEditor.getState();
    const next = new Set(current);
    for (const c of selectChanges) {
      if (c.type !== "select") continue;
      if (c.selected) next.add(c.id);
      else next.delete(c.id);
    }
    select(nodesSel, [...next]);
  }, []);

  const onNodeDragStop = useCallback((_e: unknown, _node: Node, dragged: Node[]) => {
    const positions = Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));
    useEditor.getState().apply((m) => moveNodes(m, positions), { structural: false });
  }, []);

  const toRequest = (c: RFConnection | Edge) => ({
    source: c.source,
    sourcePort: c.sourceHandle ?? "out",
    target: c.target,
    targetPort: c.targetHandle ?? "",
  });

  const isValidConnection = useCallback<IsValidConnection>((c) => {
    const m = useEditor.getState().model;
    return !!m && canConnect(m, toRequest(c)).ok;
  }, []);

  const onConnect = useCallback((c: RFConnection) => useEditor.getState().connect(toRequest(c)), []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(PRESET_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const presetId = e.dataTransfer.getData(PRESET_MIME);
      if (!presetId) return;
      e.preventDefault();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useEditor.getState().addPreset(presetId, { x: pos.x - 110, y: pos.y - 20 });
    },
    [screenToFlowPosition],
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        deleteKeyCode={null}
        multiSelectionKeyCode={["Meta", "Control", "Shift"]}
        selectionKeyCode="Shift"
        snapToGrid
        snapGrid={[20, 20]}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ background: tokens.background }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#CBD5E1" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => {
            const node = model.nodes.find((x) => x.id === n.id);
            return node ? categoryColors[NODE_CATALOG[node.type].category] ?? tokens.textSecondary : tokens.textSecondary;
          }}
          style={{ width: 160, height: 100 }}
        />
      </ReactFlow>
      {model.nodes.length === 0 && <EmptyCanvas />}
    </div>
  );
}
