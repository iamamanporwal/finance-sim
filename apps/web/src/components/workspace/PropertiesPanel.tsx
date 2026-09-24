"use client";

import { findOutput, findSlot, NODE_CATALOG, outputsFor, slotsFor, type ModelNode } from "@fin/model-schema";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { formatByUnit, type Currency } from "@/lib/format";
import { bindNewParameter, removeElements, unbindParameter, updateModelInfo, updateNode } from "@/lib/model-ops";
import { useEditor } from "@/store/editor-store";
import { categoryColors } from "@/theme/theme";
import { NodeConfigEditor } from "./NodeConfigEditor";
import { TextInput } from "./NumberInput";
import { ParameterEditor } from "./ParameterEditor";

export function PropertiesPanel() {
  const model = useEditor((s) => s.model);
  const selectedNodes = useEditor((s) => s.selectedNodes);
  const selectedEdges = useEditor((s) => s.selectedEdges);
  if (!model) return null;

  if (selectedNodes.length === 1) {
    const node = model.nodes.find((n) => n.id === selectedNodes[0]);
    if (node) return <NodeProperties key={node.id} node={node} />;
  }
  if (selectedNodes.length > 1) return <MultiSelection count={selectedNodes.length} />;
  if (selectedEdges.length > 0) return <EdgeProperties edgeIds={selectedEdges} />;
  return <ModelOverview />;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "text.secondary" }}>{title}</Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

function NodeProperties({ node }: { node: ModelNode }) {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const result = useEditor((s) => s.result);
  const period = useEditor((s) => s.selectedPeriod);
  const validation = useEditor((s) => s.validation);
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const duplicateSelection = useEditor((s) => s.duplicateSelection);
  const spec = NODE_CATALOG[node.type];
  const currency = model.settings.currency as Currency;
  const issues = validation?.issues.filter((i) => i.nodeId === node.id && !i.parameterId) ?? [];
  const point = result ? result.timeline[(period ?? result.timeline.length) - 1] : undefined;
  const values = point?.nodes[node.id];

  return (
    <Box>
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: categoryColors[spec.category] }} />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {spec.label} · {spec.category}
          </Typography>
          <Tooltip title="Duplicate (⌘D)">
            <IconButton size="small" onClick={duplicateSelection} aria-label="Duplicate node">
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete (Del)">
            <IconButton size="small" onClick={deleteSelection} aria-label="Delete node">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <TextInput fullWidth label="Name" value={node.label} required onCommit={(label) => apply((m) => updateNode(m, node.id, { label }))} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {spec.description}
        </Typography>
        <Box sx={{ mt: 1, p: 1, bgcolor: "background.default", borderRadius: 1, border: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">
            How it is calculated
          </Typography>
          <Typography sx={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{node.type === "FORMULA" ? `out = ${node.config.expression}` : spec.formula}</Typography>
        </Box>
      </Box>

      {issues.length > 0 && (
        <Box sx={{ px: 2, pb: 1 }}>
          {issues.map((i) => (
            <Stack key={i.message} direction="row" spacing={0.75} sx={{ alignItems: "flex-start", color: i.severity === "error" ? "error.main" : "warning.main", mt: 0.5 }}>
              {i.severity === "error" ? <ErrorOutlineIcon sx={{ fontSize: 16, mt: "2px" }} /> : <WarningAmberIcon sx={{ fontSize: 16, mt: "2px" }} />}
              <Typography variant="body2">{i.message}</Typography>
            </Stack>
          ))}
        </Box>
      )}

      <Divider />
      <Section title="Assumptions & inputs">
        {slotsFor(node).map((slot) => {
          const incoming = model.connections.filter((c) => c.target === node.id && c.targetPort === slot.name);
          const paramId = node.parameters[slot.name];
          const param = paramId ? model.parameters.find((p) => p.id === paramId) : undefined;
          if (incoming.length > 0) {
            return (
              <Box key={slot.name} sx={{ py: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{slot.label}</Typography>
                {incoming.map((c) => {
                  const src = model.nodes.find((n) => n.id === c.source);
                  const out = src ? findOutput(src, c.sourcePort) : undefined;
                  return (
                    <Stack key={c.id} direction="row" spacing={0.5} sx={{ alignItems: "center", color: "text.secondary" }}>
                      <LinkIcon sx={{ fontSize: 16 }} />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        From {src?.label ?? c.source}
                        {out && src && outputsFor(src).length > 1 ? ` · ${out.label}` : ""}
                      </Typography>
                      <Tooltip title="Disconnect">
                        <IconButton size="small" aria-label="Disconnect" onClick={() => apply((m) => removeElements(m, [], [c.id]))}>
                          <LinkOffIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  );
                })}
              </Box>
            );
          }
          if (param) {
            return (
              <Box key={slot.name}>
                <ParameterEditor param={param} slot={slot} />
                {!slot.required && slot.default !== undefined && (
                  <Button size="small" sx={{ mt: -0.5, mb: 0.5 }} onClick={() => apply((m) => unbindParameter(m, node.id, slot.name))}>
                    Use default ({formatByUnit(slot.default, param.unit, currency)})
                  </Button>
                )}
                <Divider />
              </Box>
            );
          }
          const missing = slot.required && slot.default === undefined;
          return (
            <Box key={slot.name} sx={{ py: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{slot.label}</Typography>
              <Typography variant="body2" color={missing ? "error.main" : "text.secondary"}>
                {missing
                  ? slot.parameter
                    ? "Required — connect a node or set a value."
                    : "Required — connect a node."
                  : `Not set — uses ${slot.default ?? 0}${slot.connectable ? " unless connected" : ""}.`}
              </Typography>
              {slot.parameter && (
                <Button size="small" sx={{ mt: 0.5 }} onClick={() => apply((m) => bindNewParameter(m, node.id, slot.name))}>
                  Set a value
                </Button>
              )}
            </Box>
          );
        })}
        {slotsFor(node).length === 0 && (
          <Typography variant="body2" color="text.secondary">
            This node has no inputs yet.
          </Typography>
        )}
      </Section>

      {hasConfig(node) && (
        <>
          <Divider />
          <Section title="Settings">
            <NodeConfigEditor node={node} />
          </Section>
        </>
      )}

      <Divider />
      <Section title={point ? `Simulated values · ${point.period}` : "Simulated values"}>
        {values ? (
          outputsFor(node).map((o) => (
            <Stack key={o.name} direction="row" sx={{ justifyContent: "space-between", py: 0.25 }}>
              <Typography variant="body2" color="text.secondary" title={o.description}>
                {o.label}
              </Typography>
              <Typography variant="body2" className="num" sx={{ fontWeight: 500 }}>
                {values[o.name] === undefined ? "—" : formatByUnit(values[o.name], o.name === "utilization" ? "percent" : node.unit, currency)}
              </Typography>
            </Stack>
          ))
        ) : (
          <Typography variant="body2" color="text.secondary">
            Run the simulation to see this node’s values.
          </Typography>
        )}
      </Section>
    </Box>
  );
}

function hasConfig(node: ModelNode): boolean {
  return ["GROWTH", "CHURN", "REVENUE", "COST", "SPLIT", "CONDITION", "FORMULA"].includes(node.type);
}

function MultiSelection({ count }: { count: number }) {
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const duplicateSelection = useEditor((s) => s.duplicateSelection);
  return (
    <Section title="Selection">
      <Typography sx={{ mb: 1.5 }}>{count} nodes selected</Typography>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" size="small" startIcon={<ContentCopyIcon />} onClick={duplicateSelection}>
          Duplicate
        </Button>
        <Button variant="outlined" size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={deleteSelection}>
          Delete
        </Button>
      </Stack>
    </Section>
  );
}

function EdgeProperties({ edgeIds }: { edgeIds: string[] }) {
  const model = useEditor((s) => s.model)!;
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const conns = model.connections.filter((c) => edgeIds.includes(c.id));
  return (
    <Section title={conns.length === 1 ? "Connection" : `${conns.length} connections`}>
      {conns.map((c) => {
        const s = model.nodes.find((n) => n.id === c.source);
        const t = model.nodes.find((n) => n.id === c.target);
        const out = s ? findOutput(s, c.sourcePort) : undefined;
        const slot = t ? findSlot(t, c.targetPort) : undefined;
        return (
          <Box key={c.id} sx={{ mb: 1.5 }}>
            <Typography variant="body2">
              <b>{s?.label}</b> · {out?.label} → <b>{t?.label}</b> · {slot?.label}
            </Typography>
            {out?.lagged && (
              <Typography variant="caption" color="text.secondary">
                Uses the value at the start of the period (previous period’s closing value), so it can feed back into its source.
              </Typography>
            )}
          </Box>
        );
      })}
      <Button variant="outlined" size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={deleteSelection}>
        Delete connection
      </Button>
    </Section>
  );
}

function ModelOverview() {
  const model = useEditor((s) => s.model)!;
  const validation = useEditor((s) => s.validation);
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const issues = validation?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <Box>
      <Section title="Model">
        <Stack spacing={1.25}>
          <TextInput label="Name" value={model.name} required onCommit={(name) => apply((m) => updateModelInfo(m, { name }))} />
          <TextInput label="Description" multiline minRows={2} value={model.description} onCommit={(description) => apply((m) => updateModelInfo(m, { description }))} />
          <Typography variant="body2" color="text.secondary">
            {model.nodes.length} nodes · {model.connections.length} connections · {model.parameters.length} assumptions
          </Typography>
        </Stack>
      </Section>
      <Divider />
      <Section title="Model check">
        {issues.length === 0 ? (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", color: "success.main" }}>
            <CheckCircleOutlineIcon sx={{ fontSize: 18 }} />
            <Typography variant="body2">{model.nodes.length ? "No problems found." : "Add nodes to start."}</Typography>
          </Stack>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {errors.length} error{errors.length === 1 ? "" : "s"} · {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              {errors.length > 0 ? " — errors block the simulation." : ""}
            </Typography>
            <List dense disablePadding>
              {[...errors, ...warnings].map((i, k) => (
                <ListItemButton key={k} disabled={!i.nodeId} onClick={() => i.nodeId && select([i.nodeId])} sx={{ px: 0.5, gap: 0.75, alignItems: "flex-start", borderRadius: 1, "&.Mui-disabled": { opacity: 1 } }}>
                  {i.severity === "error" ? <ErrorOutlineIcon color="error" sx={{ fontSize: 16, mt: "3px" }} /> : <WarningAmberIcon color="warning" sx={{ fontSize: 16, mt: "3px" }} />}
                  <Typography variant="body2">{i.message}</Typography>
                </ListItemButton>
              ))}
            </List>
          </>
        )}
      </Section>
    </Box>
  );
}
