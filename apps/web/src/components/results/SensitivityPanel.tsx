"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BarChart } from "@mui/x-charts/BarChart";
import { useEffect, useState } from "react";
import { formatByUnit, formatCount, formatCurrency, formatPercent, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

const METRICS = [
  { key: "mrr", label: "MRR" },
  { key: "arr", label: "ARR" },
  { key: "cash", label: "Cash" },
  { key: "customers", label: "Customers" },
  { key: "grossMargin", label: "Gross margin" },
  { key: "operatingProfit", label: "Operating profit" },
  { key: "revenue", label: "Revenue" },
];

export default function SensitivityPanel() {
  const model = useEditor((s) => s.model)!;
  const valid = useEditor((s) => s.validation?.valid ?? false);
  const activeScenarioId = useEditor((s) => s.activeScenarioId);
  const sens = useEditor((s) => s.sensitivity);
  const run = useEditor((s) => s.runSensitivity);
  const [metric, setMetric] = useState(sens.options?.metric ?? "mrr");
  const [delta, setDelta] = useState(sens.options?.delta ?? 0.1);
  const currency = model.settings.currency as Currency;
  const hasCash = model.nodes.some((n) => n.type === "CASH");

  // Re-run whenever the model, scenario or options change (single runs are cheap).
  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(() => run({ metric, delta }), 100);
    return () => clearTimeout(t);
  }, [model, activeScenarioId, metric, delta, valid, run]);

  const r = sens.result;
  const fmt = (v: number | null | undefined) =>
    metric === "grossMargin" ? formatPercent(v) : metric === "customers" ? formatCount(v, { compact: true }) : formatCurrency(v, currency);
  const label = METRICS.find((m) => m.key === metric)!.label;
  const impactful = r?.entries.filter((e) => e.impact > 0) ?? [];
  const noEffect = r?.entries.filter((e) => e.impact === 0) ?? [];
  const top = impactful.slice(0, 10);
  const price = impactful.find((e) => /price/i.test(e.name));
  const leader = impactful[0];

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h3">What matters most?</Typography>
        <Typography variant="body2" color="text.secondary">
          Each assumption is moved down and up by the same percentage, one at a time, and the model is re-run. Longer bars mean the outcome depends more on that assumption.
        </Typography>
      </Box>
      <Stack direction="row" spacing={2}>
        <TextField select size="small" label="Outcome" value={metric} onChange={(e) => setMetric(e.target.value)} sx={{ minWidth: 180 }}>
          {METRICS.filter((m) => hasCash || m.key !== "cash").map((m) => (
            <MenuItem key={m.key} value={m.key}>
              {m.label} at end of forecast
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Change each assumption by" value={delta} onChange={(e) => setDelta(Number(e.target.value))} sx={{ minWidth: 200 }}>
          {[0.05, 0.1, 0.2, 0.3].map((d) => (
            <MenuItem key={d} value={d}>
              ±{d * 100}%
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {!valid && <Alert severity="warning">Fix the model’s errors to run the analysis.</Alert>}
      {sens.error && <Alert severity="error">{sens.error}</Alert>}

      {r && valid && (
        <>
          <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
            {leader ? (
              <Typography>
                The assumptions with the largest effect on {label} in {r.periodLabel} (currently <b>{fmt(r.baseResult)}</b>) are:{" "}
                {impactful.slice(0, 3).map((e, i) => (
                  <span key={e.parameterId}>
                    {i > 0 ? ", " : ""}
                    <b>
                      {i + 1}. {e.name}
                    </b>
                  </span>
                ))}
                .
                {price && price !== leader && price.impact < leader.impact && (
                  <> Changing {price.name.toLowerCase()} has a smaller effect than {leader.name.toLowerCase()} in this model.</>
                )}
              </Typography>
            ) : (
              <Typography>No assumption changes {label} in this model.</Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Based on {r.runs} simulation runs. {activeScenarioId ? "Uses the active scenario." : ""}
            </Typography>
          </Paper>

          {top.length > 0 && (
            <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
              <Typography sx={{ fontWeight: 600 }}>
                Change in {label} when each assumption moves ±{r.delta * 100}%
              </Typography>
              <BarChart
                layout="horizontal"
                height={Math.max(160, top.length * 38 + 60)}
                yAxis={[{ scaleType: "band", data: top.map((e) => e.name), width: 170, tickLabelStyle: { fontSize: 11 } }]}
                xAxis={[{ valueFormatter: (v: number | null) => (metric === "grossMargin" ? formatPercent(v) : metric === "customers" ? formatCount(v, { compact: true }) : formatCurrency(v, currency, { compact: true })) }]}
                series={[
                  { data: top.map((e) => (e.lowResult ?? 0) - (r.baseResult ?? 0)), label: `Assumption −${r.delta * 100}%`, stack: "t", color: "#F97316", valueFormatter: (v) => fmt(v) },
                  { data: top.map((e) => (e.highResult ?? 0) - (r.baseResult ?? 0)), label: `Assumption +${r.delta * 100}%`, stack: "t", color: tokens.primary, valueFormatter: (v) => fmt(v) },
                ]}
              />
            </Paper>
          )}

          <Paper sx={{ p: 2, border: 1, borderColor: "divider", overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {["Assumption", "Value", `−${r.delta * 100}%`, `+${r.delta * 100}%`, "Swing"].map((h, i) => (
                    <TableCell key={h} align={i ? "right" : "left"} sx={{ fontWeight: 600 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {impactful.map((e) => (
                  <TableRow key={e.parameterId}>
                    <TableCell>{e.name}</TableCell>
                    <TableCell align="right" className="num">
                      {formatByUnit(e.baseValue, e.unit, currency)}
                    </TableCell>
                    <TableCell align="right" className="num">
                      {fmt(e.lowResult)}
                    </TableCell>
                    <TableCell align="right" className="num">
                      {fmt(e.highResult)}
                    </TableCell>
                    <TableCell align="right" className="num" sx={{ fontWeight: 600 }}>
                      {fmt(e.impact)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {noEffect.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                No effect on {label}: {noEffect.map((e) => e.name + (e.note ? ` (${e.note})` : "")).join(", ")}.
              </Typography>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}
