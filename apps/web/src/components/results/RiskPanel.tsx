"use client";

import type { MonteCarloResult } from "@fin/monte-carlo";
import type { Statistics } from "@fin/monte-carlo";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
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
import { LineChart } from "@mui/x-charts/LineChart";
import { useState } from "react";
import { formatByUnit, formatCount, formatCurrency, formatPercent, type Currency } from "@/lib/format";
import { applyDefaultUncertainty } from "@/lib/uncertainty";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";
import { NumberInput } from "../workspace/NumberInput";
import { MetricInfo } from "./MetricInfo";

const RUNS = [100, 500, 1000, 5000, 10000];

export default function RiskPanel() {
  const model = useEditor((s) => s.model)!;
  const result = useEditor((s) => s.result);
  const mc = useEditor((s) => s.monteCarlo);
  const runMc = useEditor((s) => s.runMonteCarlo);
  const cancel = useEditor((s) => s.cancelMonteCarlo);
  const apply = useEditor((s) => s.apply);
  const valid = useEditor((s) => s.validation?.valid ?? false);
  const activeScenarioId = useEditor((s) => s.activeScenarioId);
  const currency = model.settings.currency as Currency;
  const [runs, setRuns] = useState(1000);
  const [seed, setSeed] = useState(model.settings.seed);
  const [targetMrr, setTargetMrr] = useState<number | undefined>(() => (result ? Math.round(result.summary.mrr) : undefined));
  const [targetCash, setTargetCash] = useState<number | undefined>(undefined);

  const uncertain = model.parameters.filter((p) => p.distribution && p.distribution.type !== "fixed");
  const running = mc.status === "running";
  const stale = mc.result && (mc.model !== model || mc.scenarioId !== activeScenarioId);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h3">Risk & uncertainty</Typography>
        <Typography variant="body2" color="text.secondary">
          Monte Carlo runs the model many times, sampling each uncertain assumption from its range, and reports how often each outcome happens. It runs in a background worker, so the app stays responsive.
        </Typography>
      </Box>

      <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "flex-start" } }}>
          <TextField select size="small" label="Runs" value={runs} onChange={(e) => setRuns(Number(e.target.value))} sx={{ minWidth: 120 }}>
            {RUNS.map((r) => (
              <MenuItem key={r} value={r}>
                {r.toLocaleString()}
              </MenuItem>
            ))}
          </TextField>
          <NumberInput label="Seed" value={seed} onCommit={(v) => v !== undefined && setSeed(Math.max(0, Math.round(v)))} sx={{ maxWidth: 120 }} />
          <NumberInput label="Target MRR" prefix={currency === "INR" ? "₹" : "$"} value={targetMrr} onCommit={setTargetMrr} />
          <NumberInput label="Target cash" prefix={currency === "INR" ? "₹" : "$"} value={targetCash} onCommit={setTargetCash} placeholder="optional" />
          <Box sx={{ flex: 1 }} />
          {running ? (
            <Button variant="outlined" color="error" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="contained" color="secondary" startIcon={<PlayArrowIcon />} disabled={!valid || uncertain.length === 0} onClick={() => runMc({ runs, seed, targetMrr, targetCash })}>
              Run {runs.toLocaleString()} simulations
            </Button>
          )}
        </Stack>
        {running && (
          <Box sx={{ mt: 2 }} aria-live="polite">
            <Typography variant="body2" className="num" sx={{ mb: 0.5 }}>
              Running… {mc.done.toLocaleString()} / {mc.total.toLocaleString()}
            </Typography>
            <LinearProgress variant="determinate" value={mc.total ? (mc.done / mc.total) * 100 : 0} color="secondary" />
          </Box>
        )}
        {mc.status === "error" && <Alert severity="error" sx={{ mt: 2 }}>{mc.error}</Alert>}
        {!valid && <Alert severity="warning" sx={{ mt: 2 }}>Fix the model’s errors before running Monte Carlo.</Alert>}
      </Paper>

      <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>Uncertain assumptions ({uncertain.length})</Typography>
        {uncertain.length === 0 ? (
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2" color="text.secondary">
              No assumption has an uncertainty range yet, so every run would give the same answer. Set “Uncertainty” on an assumption in the Properties panel, or:
            </Typography>
            <Button variant="outlined" onClick={() => apply(applyDefaultUncertainty)}>
              Add ±25% uncertainty to rates, prices and unit costs
            </Button>
          </Stack>
        ) : (
          <Box sx={{ display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            {uncertain.map((p) => (
              <Typography key={p.id} variant="body2">
                <b>{p.name}</b> <span style={{ color: tokens.textSecondary }}>{describe(p.distribution!, p.unit, currency)}</span>
              </Typography>
            ))}
          </Box>
        )}
      </Paper>

      {mc.result && <McResults r={mc.result} currency={currency} stale={!!stale} />}
    </Stack>
  );
}

function describe(d: NonNullable<import("@fin/model-schema").Parameter["distribution"]>, unit: string, currency: Currency): string {
  const f = (v: number) => formatByUnit(v, unit, currency);
  switch (d.type) {
    case "uniform":
      return `between ${f(d.min)} and ${f(d.max)}`;
    case "triangular":
      return `worst ${f(d.min)} · likely ${f(d.mode)} · best ${f(d.max)}`;
    case "normal":
      return `normal, mean ${d.mean === undefined ? "value" : f(d.mean)}, σ ${f(d.stdDev)}`;
    case "lognormal":
      return `log-normal, mean ${f(d.mean)}, σ ${f(d.stdDev)}`;
    case "discrete":
      return `${d.outcomes.length} possible values`;
    default:
      return "fixed";
  }
}

function McResults({ r, currency, stale }: { r: MonteCarloResult; currency: Currency; stale: boolean }) {
  const money = (v: number | null | undefined) => formatCurrency(v, currency);
  const [hist, setHist] = useState<"mrr" | "cash">("mrr");
  const probs: { label: string; value: number | null; info: string; bad?: boolean }[] = [
    { label: "Probability of profitability", value: r.probabilities.profitability, info: "Share of runs with operating profit ≥ 0 in the final period." },
    { label: "Probability of cash-out", value: r.probabilities.cashOut, info: "Share of runs where cash goes below zero in any period.", bad: true },
    { label: `Reach ${money(r.targets.mrr)} MRR`, value: r.probabilities.targetMrr, info: "Share of runs whose final MRR is at least the target." },
    { label: `Reach ${money(r.targets.cash)} cash`, value: r.probabilities.targetCash, info: "Share of runs whose final cash is at least the target." },
    { label: "Probability of breaking a guardrail", value: r.probabilities.guardrailViolation, info: "Share of runs where any guardrail is not met in any period.", bad: true },
  ].filter((p) => p.value !== null);

  const statRows: { label: string; s: Statistics | null; fmt(v: number): string }[] = [
    { label: "Final MRR", s: r.metrics.mrr, fmt: money },
    { label: "Final ARR", s: r.metrics.arr, fmt: money },
    { label: "Final cash", s: r.metrics.cash, fmt: money },
    { label: "Lowest cash", s: r.metrics.minCash, fmt: money },
    { label: "Customers", s: r.metrics.customers, fmt: (v) => formatCount(v, { compact: true }) },
    { label: "Break-even period", s: r.metrics.breakEvenPeriod, fmt: (v) => v.toFixed(1) },
  ];
  const bins = r.histograms[hist];
  const bands = hist === "mrr" ? r.bands.mrr : r.bands.cash;

  return (
    <Stack spacing={2} sx={{ opacity: stale ? 0.6 : 1 }}>
      {stale && <Alert severity="info">The model or scenario changed since this run. Run again to update.</Alert>}
      <Typography variant="body2" color="text.secondary">
        Simulation complete · {r.completed.toLocaleString()} runs · seed {r.seed} · {(r.durationMs / 1000).toFixed(1)} s{r.failed ? ` · ${r.failed} runs failed and were excluded` : ""}
      </Typography>
      {r.failures.length > 0 && <Alert severity="warning">{r.failures.join(" · ")}</Alert>}
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: `repeat(${probs.length}, 1fr)` } }}>
        {probs.map((p) => (
          <Paper key={p.label} sx={{ p: 2, border: 1, borderColor: "divider" }}>
            <Typography variant="body2" color="text.secondary">
              {p.label}
              <MetricInfo text={p.info} />
            </Typography>
            <Typography className="num" sx={{ fontSize: 28, fontWeight: 600, color: p.bad && p.value! > 0.1 ? tokens.risk : undefined }}>
              {formatPercent(p.value, 0)}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Paper sx={{ p: 2, border: 1, borderColor: "divider", overflowX: "auto" }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>
          Outcome ranges <MetricInfo text="P10: 10% of runs end lower than this (a bad case). P50: the median. P90: only 10% of runs end higher (a good case)." />
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              {["", "P10", "P25", "P50", "P75", "P90", "Mean", "Min", "Max"].map((h) => (
                <TableCell key={h} align={h ? "right" : "left"} sx={{ fontWeight: 600 }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {statRows.filter((x) => x.s).map(({ label, s, fmt }) => (
              <TableRow key={label}>
                <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{label}</TableCell>
                {[s!.p10, s!.p25, s!.p50, s!.p75, s!.p90, s!.mean, s!.min, s!.max].map((v, i) => (
                  <TableCell key={i} align="right" className="num" sx={{ fontWeight: i === 2 ? 600 : 400, whiteSpace: "nowrap" }}>
                    {fmt(v)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1}>
        <Button size="small" variant={hist === "mrr" ? "contained" : "outlined"} onClick={() => setHist("mrr")}>
          MRR
        </Button>
        {r.histograms.cash.length > 0 && (
          <Button size="small" variant={hist === "cash" ? "contained" : "outlined"} onClick={() => setHist("cash")}>
            Cash
          </Button>
        )}
      </Stack>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
        <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Typography sx={{ fontWeight: 600 }}>Distribution of final {hist === "mrr" ? "MRR" : "cash"}</Typography>
          <BarChart
            height={260}
            hideLegend
            xAxis={[{ scaleType: "band", data: bins.map((b) => formatCurrency((b.from + b.to) / 2, currency, { compact: true })), tickLabelStyle: { fontSize: 9 } }]}
            yAxis={[{ label: "Runs", width: 48 }]}
            series={[{ data: bins.map((b) => b.count), label: "Runs", color: tokens.simulation }]}
          />
        </Paper>
        <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Typography sx={{ fontWeight: 600 }}>{hist === "mrr" ? "MRR" : "Cash"} over time · P10 / P50 / P90</Typography>
          <LineChart
            height={260}
            xAxis={[{ scaleType: "point", data: r.periodLabels, tickLabelStyle: { fontSize: 10 } }]}
            yAxis={[{ valueFormatter: (v: number | null) => formatCurrency(v, currency, { compact: true }), width: 64 }]}
            series={[
              { data: bands.map((b) => b.p90), label: "P90", color: "#A78BFA", showMark: false, valueFormatter: money },
              { data: bands.map((b) => b.p50), label: "P50", color: tokens.simulation, showMark: false, valueFormatter: money },
              { data: bands.map((b) => b.p10), label: "P10", color: "#C4B5FD", showMark: false, valueFormatter: money },
            ]}
          />
        </Paper>
      </Box>
    </Stack>
  );
}
