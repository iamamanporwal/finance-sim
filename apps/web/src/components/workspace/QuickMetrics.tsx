"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatCount, formatCurrency, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

/** Bottom bar in Build mode: last simulated outcome, always from engine output. */
export function QuickMetrics() {
  const result = useEditor((s) => s.result);
  const status = useEditor((s) => s.simStatus);
  const stale = useEditor((s) => s.stale);
  const validation = useEditor((s) => s.validation);
  const simError = useEditor((s) => s.simError);
  const lastRunMs = useEditor((s) => s.lastRunMs);
  const currency = useEditor((s) => s.model?.settings.currency ?? "USD") as Currency;
  const setMode = useEditor((s) => s.setMode);

  const errors = validation?.issues.filter((i) => i.severity === "error").length ?? 0;
  const last = result?.timeline[result.timeline.length - 1];
  const warnings = result?.events.filter((e) => e.severity !== "info").length ?? 0;

  const item = (label: string, value: string) => (
    <Box key={label}>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>
        {label}
      </Typography>
      <Typography component="span" className="num" sx={{ fontSize: 13, fontWeight: 600, color: stale ? "text.disabled" : "text.primary" }}>
        {value}
      </Typography>
    </Box>
  );

  let statusText: string;
  let statusColor: string = tokens.textSecondary;
  if (status === "blocked") {
    statusText = `Simulation blocked — ${errors} issue${errors === 1 ? "" : "s"} found`;
    statusColor = tokens.risk;
  } else if (status === "error") {
    statusText = simError?.message ?? "Simulation failed";
    statusColor = tokens.risk;
  } else if (stale) {
    statusText = "Recalculating…";
  } else if (result) {
    statusText = `Simulated ${result.timeline.length} periods in ${lastRunMs?.toFixed(1) ?? "?"} ms`;
  } else {
    statusText = "Not simulated yet";
  }

  return (
    <Box sx={{ height: 40, px: 2, borderTop: 1, borderColor: "divider", bgcolor: "background.paper", display: "flex", alignItems: "center", gap: 3, overflow: "hidden" }}>
      {last ? (
        <Stack direction="row" spacing={3} onClick={() => setMode("results")} sx={{ cursor: "pointer", whiteSpace: "nowrap" }} title="Open results">
          <Typography variant="caption" color="text.secondary">
            {last.period}
          </Typography>
          {item("MRR", formatCurrency(last.metrics.mrr, currency))}
          {item("GM", formatPercent(last.profit.grossMargin))}
          {item("Customers", formatCount(last.customers.closing, { compact: true }))}
          {item("Cash", last.metrics.cash === null ? "No Cash node" : formatCurrency(last.cash.closing, currency))}
          {item("Runway", formatMonths(last.metrics.runwayMonths))}
          {item("Warnings", String(warnings))}
        </Stack>
      ) : null}
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" noWrap sx={{ color: statusColor, maxWidth: 480 }}>
        {statusText}
      </Typography>
    </Box>
  );
}
