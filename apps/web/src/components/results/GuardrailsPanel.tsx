"use client";

import { getMetricDefinition, metricDefinitionsFor, type Guardrail } from "@fin/model-schema";
import { explainGuardrail } from "@fin/simulation-engine";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { addGuardrail, GUARDRAIL_SUGGESTIONS, guardrailLabel, removeGuardrail, updateGuardrail } from "@/lib/scenario-ops";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";
import { NumberInput } from "../workspace/NumberInput";

export default function GuardrailsPanel() {
  const model = useEditor((s) => s.model)!;
  const result = useEditor((s) => s.result);
  const apply = useEditor((s) => s.apply);
  const [focus, setFocus] = useState<{ guardrailId: string; period: number } | null>(null);
  const currency = model.settings.currency;
  const existing = new Set(model.guardrails.map((g) => `${g.metric}${g.operator}${g.threshold}`));
  // Only suggest guardrails on metrics this model actually produces (no credit rules without credits).
  const produced = (metric: string) => !result || result.timeline.some((p) => p.metrics[metric] !== null && p.metrics[metric] !== undefined);
  const suggestions = GUARDRAIL_SUGGESTIONS.filter((s) => !existing.has(`${s.metric}${s.operator}${s.threshold}`) && produced(s.metric));
  const explanation = focus && result ? explainGuardrail(model, result, focus.guardrailId, focus.period) : null;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h3">Guardrails</Typography>
        <Typography variant="body2" color="text.secondary">
          Limits your business should stay within. They are checked automatically in every period of every simulation.
        </Typography>
      </Box>

      <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
        <Stack spacing={1.5}>
          {model.guardrails.length === 0 && <Typography color="text.secondary">No guardrails yet. Add one below.</Typography>}
          {model.guardrails.map((g) => (
            <GuardrailRow key={g.id} g={g} currency={currency} onChange={(patch) => apply((m) => updateGuardrail(m, g.id, patch))} onRemove={() => apply((m) => removeGuardrail(m, g.id))} />
          ))}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => apply((m) => addGuardrail(m, { metric: "cash", operator: ">", threshold: 0, severity: "critical" }))}>
              Add guardrail
            </Button>
            {suggestions.map((s) => (
              <Chip key={s.metric + s.operator + s.threshold} size="small" variant="outlined" label={`+ ${guardrailLabel(s, currency)}`} onClick={() => apply((m) => addGuardrail(m, s))} />
            ))}
          </Stack>
        </Stack>
      </Paper>

      {result && model.guardrails.some((g) => g.enabled) && (
        <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>Every period</Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Box component="table" sx={{ borderCollapse: "collapse", "& td, & th": { p: 0.25, fontSize: 12, textAlign: "center" } }}>
              <thead>
                <tr>
                  <th />
                  {result.timeline.map((p) => (
                    <th key={p.index} title={p.period} style={{ fontWeight: 500, color: tokens.textSecondary }}>
                      {p.index}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.guardrails.map((r) => {
                  const g = model.guardrails.find((x) => x.id === r.guardrailId)!;
                  const bad = new Set(r.violations);
                  return (
                    <tr key={r.guardrailId}>
                      <td style={{ textAlign: "left", paddingRight: 12, whiteSpace: "nowrap" }}>{g.label}</td>
                      {result.timeline.map((p) => {
                        const violated = bad.has(p.index);
                        const selected = focus?.guardrailId === g.id && focus.period === p.index;
                        return (
                          <td key={p.index}>
                            <Tooltip title={`${p.period}: ${violated ? "not met — click for the cause" : "met"}`}>
                              <ButtonBase
                                disabled={!violated}
                                onClick={() => setFocus({ guardrailId: g.id, period: p.index })}
                                aria-label={`${g.label} in ${p.period}: ${violated ? "not met" : "met"}`}
                                sx={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: 1,
                                  fontSize: 12,
                                  color: violated ? (g.severity === "critical" ? tokens.risk : tokens.warning) : tokens.positive,
                                  bgcolor: selected ? `${tokens.warning}33` : violated ? `${g.severity === "critical" ? tokens.risk : tokens.warning}14` : "transparent",
                                }}
                              >
                                {violated ? "⚠" : "✓"}
                              </ButtonBase>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </Box>
          </Box>
          {explanation && (
            <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setFocus(null)}>
              <Typography sx={{ fontWeight: 600 }}>{explanation.headline}</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <b>Cause:</b> {explanation.cause}
              </Typography>
              {explanation.details.map((d) => (
                <Typography key={d} variant="body2">
                  {d}
                </Typography>
              ))}
              <Typography variant="caption" color="text.secondary">
                Computed from the simulation’s numbers{explanation.referencePeriod ? `, compared with ${result!.timeline[explanation.referencePeriod - 1]!.period} (last period it was met)` : ""}.
              </Typography>
            </Alert>
          )}
        </Paper>
      )}
    </Stack>
  );
}

function GuardrailRow({ g, currency, onChange, onRemove }: { g: Guardrail; currency: string; onChange(p: Partial<Guardrail>): void; onRemove(): void }) {
  const model = useEditor((s) => s.model)!;
  const unit = getMetricDefinition(g.metric, model.customMetrics)?.unit;
  const scale = unit === "percent" ? 100 : 1;
  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ alignItems: { md: "center" } }}>
      <Switch size="small" checked={g.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} slotProps={{ input: { "aria-label": `Enable ${g.label}` } }} />
      <TextField select size="small" label="Metric" value={g.metric} onChange={(e) => onChange({ metric: e.target.value })} sx={{ minWidth: 180 }}>
        {metricDefinitionsFor(model).map((m) => (
          <MenuItem key={m.key} value={m.key}>
            {m.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField select size="small" label="Must be" value={g.operator} onChange={(e) => onChange({ operator: e.target.value as Guardrail["operator"] })} sx={{ minWidth: 90 }}>
        {[">", ">=", "<", "<="].map((op) => (
          <MenuItem key={op} value={op}>
            {op}
          </MenuItem>
        ))}
      </TextField>
      <NumberInput
        label="Threshold"
        value={g.threshold}
        scale={scale}
        suffix={unit === "percent" ? "%" : unit === "months" ? "months" : undefined}
        prefix={unit === "currency" ? (currency === "INR" ? "₹" : "$") : undefined}
        onCommit={(v) => v !== undefined && onChange({ threshold: v })}
        sx={{ maxWidth: 170 }}
      />
      <TextField select size="small" label="Severity" value={g.severity} onChange={(e) => onChange({ severity: e.target.value as Guardrail["severity"] })} sx={{ minWidth: 120 }}>
        <MenuItem value="warning">Warning</MenuItem>
        <MenuItem value="critical">Critical</MenuItem>
      </TextField>
      <Typography variant="body2" sx={{ flex: 1 }} color="text.secondary" noWrap>
        {g.label}
      </Typography>
      <IconButton aria-label={`Remove ${g.label}`} onClick={onRemove}>
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}
