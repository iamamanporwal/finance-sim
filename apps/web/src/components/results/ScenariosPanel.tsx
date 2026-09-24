"use client";

import type { Scenario } from "@fin/model-schema";
import { compareScenarios, type ScenarioComparisonRow } from "@fin/simulation-engine";
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { LineChart } from "@mui/x-charts/LineChart";
import { useMemo, useState } from "react";
import { formatByUnit, formatCount, formatCurrency, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { addScenario, createStandardScenarios, deleteScenario, duplicateScenario, updateScenario } from "@/lib/scenario-ops";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";
import { TextInput } from "../workspace/NumberInput";

const KIND_COLORS: Record<Scenario["kind"], "default" | "success" | "error" | "info"> = { base: "info", upside: "success", downside: "error", custom: "default" };
const SERIES_COLORS = ["#64748B", "#4F46E5", "#10B981", "#DC2626", "#F59E0B", "#06B6D4", "#8B5CF6"];

export default function ScenariosPanel() {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const activeId = useEditor((s) => s.activeScenarioId);
  const setActive = useEditor((s) => s.setActiveScenario);
  const setMode = useEditor((s) => s.setMode);
  const valid = useEditor((s) => s.validation?.valid ?? false);
  const [selected, setSelected] = useState<string | null>(null);
  const currency = model.settings.currency as Currency;
  const scenarios = model.scenarios;
  const current = scenarios.find((s) => s.id === (selected ?? activeId)) ?? scenarios[0];

  const rows = useMemo<ScenarioComparisonRow[]>(() => {
    if (!valid) return [];
    try {
      return compareScenarios(model, [null, ...scenarios.map((s) => s.id)]);
    } catch {
      return [];
    }
  }, [model, scenarios, valid]);

  const kinds = new Set(scenarios.map((s) => s.kind));
  const missingStandard = !kinds.has("base") || !kinds.has("upside") || !kinds.has("downside");

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3">Scenarios</Typography>
          <Typography variant="body2" color="text.secondary">
            A scenario stores only the assumptions it changes. The base model is never modified.
          </Typography>
        </Box>
        {missingStandard && (
          <Tooltip title="Upside and Downside move every assumption that affects cash by 20% in its favorable or unfavorable direction (directions measured with a sensitivity analysis).">
            <span>
              <Button variant="outlined" startIcon={<AutoAwesomeIcon />} disabled={!valid} onClick={() => apply((m) => createStandardScenarios(m))}>
                Create Base / Upside / Downside
              </Button>
            </span>
          </Tooltip>
        )}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            let id = "";
            apply((m) => {
              const r = addScenario(m, { name: `Scenario ${m.scenarios.length + 1}` });
              id = r.id;
              return r.model;
            });
            setSelected(id);
          }}
        >
          New scenario
        </Button>
      </Stack>

      {scenarios.length === 0 ? (
        <Alert severity="info">No scenarios yet. Create Base / Upside / Downside, or a custom scenario such as “Pricing +20%”.</Alert>
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "280px 1fr" } }}>
          <Stack spacing={1}>
            {scenarios.map((s) => (
              <Paper
                key={s.id}
                onClick={() => setSelected(s.id)}
                sx={{ p: 1.5, border: 1, borderColor: current?.id === s.id ? "primary.main" : "divider", cursor: "pointer" }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography sx={{ fontWeight: 600, flex: 1 }} noWrap>
                    {s.name}
                  </Typography>
                  <Chip size="small" label={s.kind} color={KIND_COLORS[s.kind]} variant="outlined" />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {s.overrides.length} change{s.overrides.length === 1 ? "" : "s"}
                  {s.parentId ? ` · builds on ${scenarios.find((x) => x.id === s.parentId)?.name ?? "?"}` : ""}
                  {activeId === s.id ? " · active" : ""}
                </Typography>
              </Paper>
            ))}
          </Stack>

          {current && (
            <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
                <TextInput label="Name" value={current.name} required onCommit={(name) => apply((m) => updateScenario(m, current.id, { name }))} sx={{ flex: 1 }} />
                <Tooltip title="Duplicate">
                  <IconButton aria-label="Duplicate scenario" onClick={() => apply((m) => duplicateScenario(m, current.id).model)}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    aria-label="Delete scenario"
                    onClick={() => {
                      if (activeId === current.id) setActive(null);
                      apply((m) => deleteScenario(m, current.id));
                      setSelected(null);
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {current.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {current.description}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
                <Button
                  size="small"
                  variant={activeId === current.id ? "contained" : "outlined"}
                  color="secondary"
                  startIcon={<EditIcon />}
                  onClick={() => {
                    setActive(current.id);
                    setMode("build");
                  }}
                >
                  Edit assumptions on canvas
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    let id = "";
                    apply((m) => {
                      const r = addScenario(m, { name: `${current.name} + change`, parentId: current.id });
                      id = r.id;
                      return r.model;
                    });
                    setSelected(id);
                  }}
                >
                  New scenario based on this
                </Button>
                {activeId !== null && (
                  <Button size="small" onClick={() => setActive(null)}>
                    Back to base model
                  </Button>
                )}
              </Stack>
              <Typography sx={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "text.secondary", mb: 0.5 }}>Changed assumptions</Typography>
              {current.overrides.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No changes yet — this scenario matches {current.parentId ? "its parent" : "the base model"}. Click “Edit assumptions on canvas”, then change any value.
                </Typography>
              ) : (
                <Table size="small">
                  <TableBody>
                    {current.overrides.map((o) => {
                      const p = model.parameters.find((x) => x.id === o.parameterId);
                      if (!p || o.value === undefined) return null;
                      return (
                        <TableRow key={o.parameterId}>
                          <TableCell sx={{ pl: 0 }}>{p.name}</TableCell>
                          <TableCell className="num" align="right">
                            {formatByUnit(p.value, p.unit, currency)} → <b>{formatByUnit(o.value, p.unit, currency)}</b>
                          </TableCell>
                          <TableCell align="right" sx={{ pr: 0, width: 40 }}>
                            <IconButton
                              size="small"
                              aria-label={`Remove change to ${p.name}`}
                              onClick={() => apply((m) => ({ ...m, scenarios: m.scenarios.map((s) => (s.id === current.id ? { ...s, overrides: s.overrides.filter((x) => x.parameterId !== o.parameterId) } : s)) }))}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Paper>
          )}
        </Box>
      )}

      {!valid && <Alert severity="warning">Fix the model’s errors to compare scenarios.</Alert>}
      {rows.length > 1 && <Comparison rows={rows} currency={currency} />}
    </Stack>
  );
}

function Comparison({ rows, currency }: { rows: ScenarioComparisonRow[]; currency: Currency }) {
  const ok = rows.filter((r) => r.summary && r.result);
  const base = ok[0];
  const money = (v: number | null | undefined) => formatCurrency(v, currency);
  const metricRows: { label: string; get(r: ScenarioComparisonRow): number | null | undefined; fmt(v: number | null | undefined): string; higher: boolean }[] = [
    { label: "MRR", get: (r) => r.summary!.mrr, fmt: money, higher: true },
    { label: "ARR", get: (r) => r.summary!.arr, fmt: money, higher: true },
    { label: "Customers", get: (r) => r.summary!.customers, fmt: (v) => formatCount(v, { compact: true }), higher: true },
    { label: "Gross margin", get: (r) => r.summary!.grossMargin, fmt: (v) => formatPercent(v), higher: true },
    { label: "Cash", get: (r) => r.summary!.cash, fmt: money, higher: true },
    { label: "Lowest cash", get: (r) => r.minCash, fmt: money, higher: true },
    { label: "Shortest runway", get: (r) => r.minRunwayMonths, fmt: (v) => formatMonths(v), higher: true },
    { label: "Break-even period", get: (r) => r.summary!.breakEvenPeriod, fmt: (v) => (v === null || v === undefined ? "Not reached" : `Period ${v}`), higher: false },
  ];
  const labels = base?.result?.timeline.map((p) => p.period) ?? [];
  const hasCash = base?.summary?.cash !== null;

  return (
    <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
      <Typography variant="h3" sx={{ mb: 1 }}>
        Comparison · end of forecast
      </Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              {rows.map((r) => (
                <TableCell key={r.scenarioId === null ? "__base-model" : `s-${r.scenarioId}`} align="right" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {r.name}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {metricRows.map((m) => (
              <TableRow key={m.label}>
                <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{m.label}</TableCell>
                {rows.map((r, i) => {
                  if (r.error) return <TableCell key={i} align="right" sx={{ color: "error.main" }}>Error</TableCell>;
                  const v = m.get(r);
                  const b = base ? m.get(base) : undefined;
                  const better = i > 0 && v !== null && v !== undefined && b !== null && b !== undefined && v !== b ? (v > b) === m.higher : null;
                  return (
                    <TableCell key={i} align="right" className="num" sx={{ color: better === null ? undefined : better ? tokens.positive : tokens.risk, fontWeight: i === 0 ? 500 : 400, whiteSpace: "nowrap" }}>
                      {m.fmt(v)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {rows.filter((r) => r.error).map((r) => (
        <Alert key={r.name} severity="error" sx={{ mt: 1 }}>
          {r.name}: {r.error}
        </Alert>
      ))}
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, mt: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 600 }}>MRR by scenario</Typography>
          <LineChart
            height={240}
            xAxis={[{ scaleType: "point", data: labels, tickLabelStyle: { fontSize: 10 } }]}
            yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v, currency, { compact: true }), width: 64 }]}
            series={ok.map((r, i) => ({ data: r.result!.timeline.map((p) => p.metrics.mrr ?? 0), label: r.name, color: SERIES_COLORS[i % SERIES_COLORS.length], showMark: false, valueFormatter: (v: number | null) => formatCurrency(v, currency) }))}
          />
        </Box>
        {hasCash && (
          <Box>
            <Typography sx={{ fontWeight: 600 }}>Cash by scenario</Typography>
            <LineChart
              height={240}
              xAxis={[{ scaleType: "point", data: labels, tickLabelStyle: { fontSize: 10 } }]}
              yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v, currency, { compact: true }), width: 64 }]}
              series={ok.map((r, i) => ({ data: r.result!.timeline.map((p) => p.cash.closing), label: r.name, color: SERIES_COLORS[i % SERIES_COLORS.length], showMark: false, valueFormatter: (v: number | null) => formatCurrency(v, currency) }))}
            />
          </Box>
        )}
      </Box>
    </Paper>
  );
}
