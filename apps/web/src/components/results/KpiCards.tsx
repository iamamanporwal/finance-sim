"use client";

import type { SimulationResult } from "@fin/model-schema";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { formatCount, formatCurrency, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { tokens } from "@/theme/theme";
import { MetricInfo } from "./MetricInfo";

interface Kpi {
  key: string;
  label: string;
  value: string;
  sub?: string;
  delta?: { text: string; good: boolean | null };
  info?: string;
}

/** KPI cards for the final period, with deltas against a baseline run when one exists. */
export function KpiCards({ result, baseline, currency }: { result: SimulationResult; baseline?: SimulationResult | null; currency: Currency }) {
  const t = result.timeline;
  const last = t[t.length - 1]!;
  const base = baseline?.timeline[baseline.timeline.length - 1];
  const money = (v: number | null | undefined) => formatCurrency(v, currency);
  const hasCash = last.metrics.cash !== null;

  const minCash = hasCash ? t.reduce((m, p) => (p.cash.closing < m.cash.closing ? p : m), t[0]!) : null;
  const peakBurn = t.reduce((m, p) => ((p.metrics.burn ?? 0) > (m.metrics.burn ?? 0) ? p : m), t[0]!);
  const minRunway = t.filter((p) => p.metrics.runwayMonths !== null).reduce<typeof last | null>((m, p) => (!m || p.metrics.runwayMonths! < m.metrics.runwayMonths! ? p : m), null);

  const delta = (cur: number | null | undefined, prev: number | null | undefined, fmt: (v: number) => string, higherIsBetter: boolean) => {
    if (!base || cur === null || cur === undefined || prev === null || prev === undefined) return undefined;
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return { text: "no change", good: null };
    return { text: `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`, good: d > 0 === higherIsBetter };
  };

  const be = result.summary.breakEvenPeriod;
  const baseBe = baseline?.summary.breakEvenPeriod;
  const kpis: Kpi[] = [
    { key: "mrr", label: "MRR", value: money(last.metrics.mrr ?? 0), sub: last.period, delta: delta(last.metrics.mrr, base?.metrics.mrr, money, true) },
    { key: "arr", label: "ARR", value: money(last.metrics.arr ?? 0), sub: "MRR × 12", delta: delta(last.metrics.arr, base?.metrics.arr, money, true) },
    { key: "customers", label: "Customers", value: formatCount(last.customers.closing, { compact: true }), sub: `+${formatCount(last.customers.new)} new · −${formatCount(last.customers.churned)} churned`, delta: delta(last.customers.closing, base?.customers.closing, (v) => formatCount(v, { compact: true }), true) },
    { key: "grossMargin", label: "Gross margin", value: formatPercent(last.profit.grossMargin), sub: last.profit.grossMargin === null ? "No revenue yet" : undefined, delta: delta(last.profit.grossMargin, base?.profit.grossMargin, (v) => `${(v * 100).toFixed(1)} pts`, true) },
    { key: "cash", label: "Cash", value: hasCash ? money(last.cash.closing) : "No Cash node", sub: minCash ? `Lowest ${money(minCash.cash.closing)} in ${minCash.period}` : undefined, delta: hasCash ? delta(last.cash.closing, base?.cash.closing, money, true) : undefined },
    { key: "burn", label: "Monthly burn", value: (last.metrics.burn ?? 0) > 0 ? money(last.metrics.burn) : "Not burning", sub: (peakBurn.metrics.burn ?? 0) > 0 ? `Peak ${money(peakBurn.metrics.burn)} in ${peakBurn.period}` : "Cash flow positive every period", delta: delta(last.metrics.burn, base?.metrics.burn, money, false) },
    { key: "runwayMonths", label: "Runway", value: hasCash ? formatMonths(last.metrics.runwayMonths) : "—", sub: minRunway ? `Shortest ${formatMonths(minRunway.metrics.runwayMonths)} in ${minRunway.period}` : undefined },
    {
      key: "breakEven",
      label: "Break-even",
      value: be ? `Period ${be}` : "Not reached",
      sub: be ? t[be - 1]!.period : `Within ${t.length} periods`,
      info: "The first period where revenue covers all costs (operating profit ≥ 0).",
      delta: baseline && be !== baseBe ? { text: baseBe ? (be ? `${be - baseBe > 0 ? "+" : ""}${be - baseBe} periods` : "no longer reached") : "now reached", good: baseBe ? (be ? be < baseBe : false) : true } : undefined,
    },
  ];

  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" } }}>
      {kpis.map((k) => (
        <Paper key={k.key} sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Typography variant="body2" color="text.secondary">
            {k.label}
            <MetricInfo metric={k.key} text={k.info} />
          </Typography>
          <Typography className="num" sx={{ fontSize: 26, fontWeight: 600, lineHeight: 1.3, mt: 0.5 }}>
            {k.value}
          </Typography>
          {k.delta && (
            <Typography className="num" variant="caption" sx={{ display: "block", fontWeight: 500, color: k.delta.good === null ? "text.secondary" : k.delta.good ? tokens.positive : tokens.risk }}>
              {k.delta.text} vs before
            </Typography>
          )}
          {k.sub && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} noWrap title={k.sub}>
              {k.sub}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  );
}
