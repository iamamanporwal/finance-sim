"use client";

import type { Model, SimulationResult } from "@fin/model-schema";
import { actualsVsForecast, type ActualField } from "@fin/simulation-engine";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { LineChart } from "@mui/x-charts/LineChart";
import { useMemo, useState } from "react";
import { formatCount, formatCurrency, formatPercent, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

const FIELDS: { key: ActualField; label: string; kind: "money" | "count" }[] = [
  { key: "mrr", label: "MRR", kind: "money" },
  { key: "revenue", label: "Revenue", kind: "money" },
  { key: "customers", label: "Customers", kind: "count" },
  { key: "cash", label: "Cash", kind: "money" },
  { key: "newCustomers", label: "New customers", kind: "count" },
  { key: "churnedCustomers", label: "Churned customers", kind: "count" },
  { key: "cogs", label: "COGS", kind: "money" },
  { key: "opex", label: "Operating expenses", kind: "money" },
];

/** Actuals ─────── | Forecast ──────► with variance where both exist. */
export default function ActualsVsForecast({ model, result }: { model: Model; result: SimulationResult }) {
  const openBusiness = useEditor((s) => s.openBusiness);
  const rows = useMemo(() => actualsVsForecast(model, result), [model, result]);
  const available = FIELDS.filter((f) => rows.some((r) => r.actual[f.key] !== undefined));
  const [field, setField] = useState<ActualField | null>(null);
  const currency = model.settings.currency as Currency;
  if (model.actuals.length === 0) return null;
  const f = available.find((x) => x.key === field) ?? available[0];
  if (!f) return null;
  const fmt = (v: number | null) => (f.kind === "money" ? formatCurrency(v, currency, { compact: true }) : formatCount(v, { compact: true }));
  const labels = rows.map((r) => r.period);
  const firstForecast = rows.find((r) => r.kind === "forecast")?.period;
  const compared = rows.filter((r) => r.kind === "forecast" && Object.keys(r.actual).length > 0);
  return (
    <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <Typography sx={{ fontWeight: 600, flex: 1 }}>Actuals vs forecast</Typography>
        <TextField select size="small" label="Metric" value={f.key} onChange={(e) => setField(e.target.value as ActualField)} sx={{ minWidth: 160 }}>
          {available.map((x) => (
            <MenuItem key={x.key} value={x.key}>
              {x.label}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" onClick={() => openBusiness("actuals")}>
          Edit actuals
        </Button>
      </Stack>
      <LineChart
        height={240}
        margin={{ left: 8, right: 16, top: 16, bottom: 8 }}
        xAxis={[{ scaleType: "point", data: labels, tickLabelStyle: { fontSize: 10 } }]}
        yAxis={[{ valueFormatter: fmt, width: 64 }]}
        grid={{ horizontal: true }}
        series={[
          { data: rows.map((r) => r.actual[f.key] ?? null), label: "Actual", color: tokens.info, connectNulls: true, valueFormatter: fmt },
          { data: rows.map((r) => (r.kind === "forecast" ? r.forecast[f.key] ?? null : null)), label: "Forecast", color: tokens.simulation, showMark: false, valueFormatter: fmt },
        ]}
      >
        {firstForecast && <ChartsReferenceLine x={firstForecast} label="Forecast →" labelAlign="start" lineStyle={{ stroke: "#94A3B8", strokeDasharray: "3 3" }} labelStyle={{ fontSize: 10 }} />}
      </LineChart>
      {compared.length > 0 && (
        <Box sx={{ overflowX: "auto", mt: 1 }}>
          <Table size="small" aria-label="Variance">
            <TableHead>
              <TableRow>
                {["Month", `Actual ${f.label}`, "Forecast", "Variance"].map((h, i) => (
                  <TableCell key={h} align={i ? "right" : "left"} sx={{ fontWeight: 600 }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {compared
                .filter((r) => r.actual[f.key] !== undefined)
                .map((r) => {
                  const v = r.variance[f.key];
                  return (
                    <TableRow key={r.period}>
                      <TableCell>{r.period}</TableCell>
                      <TableCell align="right" className="num">
                        {fmt(r.actual[f.key]!)}
                      </TableCell>
                      <TableCell align="right" className="num">
                        {fmt(r.forecast[f.key] ?? null)}
                      </TableCell>
                      <TableCell align="right" className="num" sx={{ color: v === null || v === undefined ? "text.secondary" : v >= 0 ? tokens.positive : tokens.risk }}>
                        {v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${formatPercent(v)}`}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Paper>
  );
}
