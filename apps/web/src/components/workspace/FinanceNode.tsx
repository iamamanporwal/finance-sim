"use client";

import { NODE_CATALOG, outputsFor, slotsFor, type Model } from "@fin/model-schema";
import { resolveParameterValues } from "@fin/simulation-engine";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";
import { formatByUnit, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { categoryColors, tokens } from "@/theme/theme";

export interface FinanceNodeData extends Record<string, unknown> {
  inCycle?: boolean;
}

const ROW = 20;

function FinanceNodeView({ id, selected, data }: NodeProps & { data: FinanceNodeData }) {
  const node = useEditor((s) => s.model?.nodes.find((n) => n.id === id));
  const parameters = useEditor((s) => s.model?.parameters);
  const scenarios = useEditor((s) => s.model?.scenarios);
  const activeScenarioId = useEditor((s) => s.activeScenarioId);
  const currency = useEditor((s) => s.model?.settings.currency ?? "USD") as Currency;
  const result = useEditor((s) => s.result);
  const stale = useEditor((s) => s.stale);
  const period = useEditor((s) => s.selectedPeriod);
  const issues = useEditor((s) => s.validation?.issues);
  const simError = useEditor((s) => s.simError);

  const view = useMemo(() => {
    if (!node) return null;
    const spec = NODE_CATALOG[node.type];
    const inputs = slotsFor(node).filter((s) => s.connectable);
    const outputs = outputsFor(node);
    // Show the values in effect for the active scenario.
    const effective = activeScenarioId && parameters && scenarios ? resolveParameterValues({ parameters, scenarios } as Model, activeScenarioId) : null;
    const assumptions = Object.entries(node.parameters)
      .map(([slot, pid]) => {
        const p = parameters?.find((x) => x.id === pid);
        const v = effective?.get(pid)?.toNumber();
        return { slot: slotsFor(node).find((s) => s.name === slot), param: p && v !== undefined ? { ...p, value: v, overridden: v !== p.value } : p && { ...p, overridden: false } };
      })
      .filter((a) => a.slot && a.param)
      .slice(0, 3);
    const nodeIssues = issues?.filter((i) => i.nodeId === id) ?? [];
    const severity = simError?.nodeId === id || nodeIssues.some((i) => i.severity === "error") ? "error" : nodeIssues.length ? "warning" : null;
    return { spec, inputs, outputs, assumptions, severity, issueText: nodeIssues[0]?.message ?? simError?.message };
  }, [node, parameters, scenarios, activeScenarioId, issues, simError, id]);

  if (!node || !view) return null;
  const color = categoryColors[view.spec.category] ?? tokens.textSecondary;
  const point = result ? result.timeline[(period ?? result.timeline.length) - 1] : undefined;
  const simulated = point?.nodes[id];
  const mainPort = view.outputs[0]?.name ?? "out";
  const rows = Math.max(view.inputs.length, view.outputs.length);
  const borderColor = view.severity === "error" || data.inCycle ? tokens.risk : view.severity === "warning" ? tokens.warning : selected ? tokens.primary : tokens.border;

  return (
    <Box
      title={view.issueText}
      sx={{
        width: 220,
        bgcolor: "background.paper",
        border: `1.5px solid ${borderColor}`,
        borderRadius: 2,
        boxShadow: selected ? `0 0 0 3px ${tokens.primary}22` : "0 1px 2px rgba(15,23,42,0.06)",
        fontSize: 12,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.75, borderBottom: `1px solid ${tokens.border}` }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
          {node.label}
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4 }}>{view.spec.label}</Typography>
      </Box>

      {rows > 0 && (
        <Box sx={{ py: 0.5 }}>
          {Array.from({ length: rows }, (_, i) => {
            const input = view.inputs[i];
            const output = view.outputs[i];
            return (
              <Box key={i} sx={{ position: "relative", height: ROW, display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.25 }}>
                {input ? (
                  <>
                    <Handle type="target" position={Position.Left} id={input.name} style={{ background: tokens.surface, border: `1.5px solid ${color}` }} />
                    <Typography sx={{ fontSize: 11, color: "text.secondary" }} noWrap>
                      {input.label}
                    </Typography>
                  </>
                ) : (
                  <span />
                )}
                {output ? (
                  <>
                    <Typography sx={{ fontSize: 11, color: "text.secondary", fontStyle: output.lagged ? "italic" : "normal" }} noWrap title={output.description}>
                      {output.label}
                    </Typography>
                    <Handle type="source" position={Position.Right} id={output.name} style={{ background: color, border: `1.5px solid ${color}` }} />
                  </>
                ) : (
                  <span />
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {view.assumptions.length > 0 && (
        <Box sx={{ px: 1.25, py: 0.5, borderTop: `1px dashed ${tokens.border}` }}>
          {view.assumptions.map(({ slot, param }) => (
            <Box key={slot!.name} sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
              <Typography sx={{ fontSize: 11, color: "text.secondary" }} noWrap>
                {slot!.label}
              </Typography>
              <Typography className="num" sx={{ fontSize: 11, fontWeight: 500, color: param!.overridden ? tokens.simulation : undefined }} noWrap>
                {formatByUnit(param!.value, param!.unit, currency)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {simulated && simulated[mainPort] !== undefined && (
        <Box sx={{ px: 1.25, py: 0.5, bgcolor: stale ? "transparent" : `${tokens.simulation}0D`, borderTop: `1px solid ${tokens.border}`, borderRadius: "0 0 8px 8px", display: "flex", justifyContent: "space-between" }}>
          <Typography sx={{ fontSize: 11, color: stale ? "text.disabled" : tokens.simulation }}>{point!.period}</Typography>
          <Typography className="num" sx={{ fontSize: 11.5, fontWeight: 600, color: stale ? "text.disabled" : "text.primary" }}>
            {formatByUnit(simulated[mainPort], node.unit, currency)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export const FinanceNode = memo(FinanceNodeView);
