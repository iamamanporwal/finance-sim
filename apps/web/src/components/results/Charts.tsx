"use client";

import type { SimulationResult } from "@fin/model-schema";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { BarChart } from "@mui/x-charts/BarChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { LineChart } from "@mui/x-charts/LineChart";
import type { ReactNode } from "react";
import { formatCount, formatCurrency, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { tokens } from "@/theme/theme";
import { MetricInfo } from "./MetricInfo";

const HEIGHT = 220;
const MARGIN = { left: 8, right: 16, top: 16, bottom: 8 };

/** All charts are derived from the simulation result — never from demo data. */
export default function Charts({ result, currency, selectedPeriod, onSelectPeriod }: { result: SimulationResult; currency: Currency; selectedPeriod: number | null; onSelectPeriod(period: number): void }) {
  const t = result.timeline;
  const labels = t.map((p) => p.period);
  const money = (v: number | null) => formatCurrency(v, currency, { compact: true });
  const selectedLabel = selectedPeriod ? labels[selectedPeriod - 1] : undefined;
  const hasCash = t[0]?.metrics.cash !== null;
  const common = {
    height: HEIGHT,
    margin: MARGIN,
    xAxis: [{ scaleType: "point" as const, data: labels, tickLabelStyle: { fontSize: 10 } }],
    onAxisClick: (_e: unknown, d: { dataIndex: number } | null) => d && onSelectPeriod(d.dataIndex + 1),
    grid: { horizontal: true },
  };
  const bandAxis = [{ scaleType: "band" as const, data: labels, tickLabelStyle: { fontSize: 10 } }];
  const marker = selectedLabel ? <ChartsReferenceLine x={selectedLabel} lineStyle={{ stroke: tokens.simulation, strokeDasharray: "4 3" }} /> : null;

  const revenueSeries = (["subscription", "usage", "topups", "other"] as const)
    .filter((k) => t.some((p) => p.revenue[k] !== 0))
    .map((k, i) => ({
      data: t.map((p) => p.revenue[k]),
      label: { subscription: "Subscription", usage: "Usage", topups: "Top-ups", other: "Other" }[k],
      stack: "revenue",
      color: ["#10B981", "#34D399", "#6EE7B7", "#A7F3D0"][i],
      valueFormatter: money,
    }));

  const runwayAll = t.map((p) => p.metrics.runwayMonths ?? null);
  // Runway explodes toward infinity as burn approaches zero; cap the chart so it stays readable.
  const RUNWAY_CAP = 60;
  const runwayCapped = runwayAll.map((v) => (v === null ? null : Math.min(v, RUNWAY_CAP)));
  const runwayWasCapped = runwayAll.some((v) => v !== null && v > RUNWAY_CAP);

  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
      <ChartCard title="MRR" metric="mrr">
        <LineChart {...common} hideLegend yAxis={[{ valueFormatter: money, width: 64 }]} series={[{ data: t.map((p) => p.metrics.mrr ?? 0), label: "MRR", color: tokens.primary, area: true, showMark: false, valueFormatter: money }]}>
          {marker}
        </LineChart>
      </ChartCard>

      <ChartCard title="Revenue by type" metric="revenue">
        {revenueSeries.length ? (
          <BarChart {...common} xAxis={bandAxis} hideLegend={revenueSeries.length < 2} yAxis={[{ valueFormatter: money, width: 64 }]} series={revenueSeries}>
            {marker}
          </BarChart>
        ) : (
          <Empty text="No revenue in any period." />
        )}
      </ChartCard>

      <ChartCard title="Revenue vs COGS" metric="cogs">
        <LineChart
          {...common}
          yAxis={[{ valueFormatter: money, width: 64 }]}
          series={[
            { data: t.map((p) => p.revenue.total), label: "Revenue", color: "#10B981", showMark: false, valueFormatter: money },
            { data: t.map((p) => p.costs.cogs), label: "COGS", color: "#F97316", showMark: false, valueFormatter: money },
          ]}
        >
          {marker}
        </LineChart>
      </ChartCard>

      <ChartCard title="Gross margin" metric="grossMargin">
        <LineChart
          {...common}
          hideLegend
          yAxis={[{ valueFormatter: (v: number | null) => formatPercent(v, 0), width: 48 }]}
          series={[{ data: t.map((p) => p.profit.grossMargin), label: "Gross margin", color: "#0EA5E9", showMark: false, connectNulls: false, valueFormatter: (v) => formatPercent(v) }]}
        >
          {marker}
        </LineChart>
      </ChartCard>

      <ChartCard title="Customers" metric="customers">
        <LineChart
          {...common}
          yAxis={[{ valueFormatter: (v: number | null) => formatCount(v, { compact: true }), width: 56 }]}
          series={[
            { data: t.map((p) => p.customers.closing), label: "Customers", color: "#8B5CF6", showMark: false, valueFormatter: (v) => formatCount(v) },
            { data: t.map((p) => p.customers.new), label: "New", color: "#C4B5FD", showMark: false, valueFormatter: (v) => formatCount(v) },
            { data: t.map((p) => p.customers.churned), label: "Churned", color: "#F87171", showMark: false, valueFormatter: (v) => formatCount(v) },
          ]}
        >
          {marker}
        </LineChart>
      </ChartCard>

      <ChartCard title="Cash" metric="cash">
        {hasCash ? (
          <LineChart {...common} hideLegend yAxis={[{ valueFormatter: money, width: 64 }]} series={[{ data: t.map((p) => p.cash.closing), label: "Cash", color: tokens.info, area: true, showMark: false, valueFormatter: money }]}>
            <ChartsReferenceLine y={0} lineStyle={{ stroke: tokens.risk, strokeWidth: 1 }} />
            {marker}
          </LineChart>
        ) : (
          <Empty text="Add a Cash node to track your bank balance." />
        )}
      </ChartCard>

      <ChartCard title="Monthly burn" metric="burn">
        {t.some((p) => (p.metrics.burn ?? 0) > 0) ? (
          <BarChart {...common} xAxis={bandAxis} hideLegend yAxis={[{ valueFormatter: money, width: 64 }]} series={[{ data: t.map((p) => p.metrics.burn ?? 0), label: "Burn", color: tokens.risk, valueFormatter: money }]}>
            {marker}
          </BarChart>
        ) : (
          <Empty text="Not burning cash in any period." />
        )}
      </ChartCard>

      <ChartCard title="Runway" metric="runwayMonths">
        {hasCash && runwayAll.some((v) => v !== null) ? (
          <>
          <LineChart
            {...common}
            hideLegend
            yAxis={[{ valueFormatter: (v: number | null) => formatMonths(v, "—"), width: 56, max: runwayWasCapped ? RUNWAY_CAP : undefined }]}
            series={[{ data: runwayCapped, label: "Runway", color: tokens.warning, showMark: false, connectNulls: false, valueFormatter: (_v, { dataIndex }) => formatMonths(runwayAll[dataIndex] ?? null) }]}
          >
            {marker}
          </LineChart>
          {runwayWasCapped && (
            <Typography variant="caption" color="text.secondary">
              Chart capped at {RUNWAY_CAP} months; hover for exact values. Empty periods are not burning cash.
            </Typography>
          )}
          </>
        ) : (
          <Empty text={hasCash ? "Not burning cash in any period, so runway is unlimited." : "Add a Cash node to see runway."} />
        )}
      </ChartCard>
    </Box>
  );
}

function ChartCard({ title, metric, children }: { title: string; metric: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2, pb: 1, border: 1, borderColor: "divider", minWidth: 0 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
        {title}
        <MetricInfo metric={metric} />
      </Typography>
      {children}
    </Paper>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Box sx={{ height: HEIGHT, display: "grid", placeItems: "center" }}>
      <Typography color="text.secondary" variant="body2">
        {text}
      </Typography>
    </Box>
  );
}
