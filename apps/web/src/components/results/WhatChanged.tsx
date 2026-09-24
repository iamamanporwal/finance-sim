"use client";

import type { SimulationResult } from "@fin/model-schema";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatByUnit, formatCurrency, formatMonths, type Currency } from "@/lib/format";
import type { ChangeTracker } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

/** "What changed?": the last edited assumption and its effect on key outcomes. */
export function WhatChanged({ change, result, currentValue, currency }: { change: ChangeTracker; result: SimulationResult; currentValue: number; currency: Currency }) {
  const before = change.baseline;
  const b = before.timeline[before.timeline.length - 1]!;
  const a = result.timeline[result.timeline.length - 1]!;
  const money = (v: number | null | undefined) => formatCurrency(v, currency);
  const rows = [
    { label: `${a.period} MRR`, from: money(b.metrics.mrr ?? 0), to: money(a.metrics.mrr ?? 0), up: (a.metrics.mrr ?? 0) >= (b.metrics.mrr ?? 0) },
    ...(a.metrics.cash !== null ? [{ label: "Cash", from: money(b.cash.closing), to: money(a.cash.closing), up: a.cash.closing >= b.cash.closing }] : []),
    { label: "Runway", from: formatMonths(b.metrics.runwayMonths), to: formatMonths(a.metrics.runwayMonths), up: (a.metrics.runwayMonths ?? Infinity) >= (b.metrics.runwayMonths ?? Infinity) },
    {
      label: "Break-even",
      from: before.summary.breakEvenPeriod ? `period ${before.summary.breakEvenPeriod}` : "not reached",
      to: result.summary.breakEvenPeriod ? `period ${result.summary.breakEvenPeriod}` : "not reached",
      up: (result.summary.breakEvenPeriod ?? Infinity) <= (before.summary.breakEvenPeriod ?? Infinity),
    },
  ];
  return (
    <Paper sx={{ p: 2, border: 1, borderColor: tokens.simulation + "55", bgcolor: tokens.simulation + "08" }}>
      <Typography sx={{ fontWeight: 600 }}>
        What changed? {change.parameterName}: {formatByUnit(change.from, change.unit, currency)} → {formatByUnit(currentValue, change.unit, currency)}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 4 }} sx={{ mt: 1 }}>
        {rows.map((r) => (
          <Typography key={r.label} variant="body2" className="num">
            <span style={{ color: tokens.textSecondary }}>{r.label}: </span>
            {r.from} → <b style={{ color: r.from === r.to ? undefined : r.up ? tokens.positive : tokens.risk }}>{r.to}</b>
          </Typography>
        ))}
      </Stack>
    </Paper>
  );
}
