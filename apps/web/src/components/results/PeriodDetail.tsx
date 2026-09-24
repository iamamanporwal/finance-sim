"use client";

import { getMetricDefinition, type Model, type SimulationResult } from "@fin/model-schema";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState, type ReactNode } from "react";
import Link from "@mui/material/Link";
import { explainGuardrail } from "@fin/simulation-engine";
import { formatByUnit, formatCount, formatCurrency, formatMetric, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { MetricInfo } from "./MetricInfo";

const CATEGORY_LABELS: Record<string, string> = {
  ai: "AI",
  infrastructure: "Hosting / infrastructure",
  payment: "Payment fees",
  payroll: "Salaries",
  marketing: "Marketing",
  rent: "Rent",
  software: "Software",
  other: "Other",
};

function Row({ label, value, strong, metric, indent, period }: { label: string; value: string; strong?: boolean; metric?: string; indent?: boolean; period?: number }) {
  const openWhy = useEditor((s) => s.openWhy);
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", py: 0.4, pl: indent ? 1.5 : 0, "&:hover .why": { opacity: 1 } }}>
      <Typography variant="body2" color={strong ? "text.primary" : "text.secondary"} sx={{ fontWeight: strong ? 600 : 400 }}>
        {label}
        {metric && <MetricInfo metric={metric} />}
        {metric && period && (
          <Link component="button" className="why" variant="caption" underline="hover" onClick={() => openWhy({ metric }, period)} sx={{ ml: 0.75, opacity: 0.55, "&:focus-visible": { opacity: 1 } }} aria-label={`Why is ${label} ${value}?`}>
            Why?
          </Link>
        )}
      </Typography>
      <Typography variant="body2" className="num" sx={{ fontWeight: strong ? 600 : 500 }}>
        {value}
      </Typography>
    </Stack>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "text.secondary", mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

/** Everything that happened in one period, straight from the timeline point. */
export function PeriodDetail({ model, result, period, currency }: { model: Model; result: SimulationResult; period: number; currency: Currency }) {
  const p = result.timeline[period - 1];
  if (!p) return null;
  const money = (v: number) => formatCurrency(v, currency, { compact: false });
  const events = result.events.filter((e) => e.period === period);
  const hasCash = p.metrics.cash !== null;
  const revenueParts = (["subscription", "usage", "topups", "other"] as const).filter((k) => p.revenue[k] !== 0);
  const categories = Object.entries(p.costs.byCategory).filter(([, v]) => v !== 0);
  const guardrails = model.guardrails.filter((g) => g.enabled);

  return (
    <Paper sx={{ p: 2.5, border: 1, borderColor: "divider" }}>
      <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h3">
          Period {p.index} · {p.period}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Forecast · simulated with seed {result.seed}
        </Typography>
      </Stack>

      {events.length > 0 && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {events.map((e, i) => (
            <Alert key={i} severity={e.severity === "critical" ? "error" : e.severity === "warning" ? "warning" : "success"} variant="outlined" sx={{ py: 0 }}>
              {e.message}
            </Alert>
          ))}
        </Stack>
      )}

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" } }}>
        <Stack spacing={2}>
          <Block title="Revenue">
            {revenueParts.map((k) => (
              <Row key={k} indent label={{ subscription: "Subscriptions", usage: "Usage", topups: "Top-ups", other: "Other" }[k]} value={money(p.revenue[k])} />
            ))}
            <Row strong label="Total revenue" metric="revenue" period={period} value={money(p.revenue.total)} />
            <Row label="MRR" metric="mrr" period={period} value={money(p.metrics.mrr ?? 0)} />
          </Block>
          <Block title="Profitability">
            <Row label="COGS" metric="cogs" period={period} value={money(p.costs.cogs)} />
            <Row strong label="Gross profit" metric="grossProfit" period={period} value={money(p.profit.grossProfit)} />
            <Row label="Gross margin" metric="grossMargin" period={period} value={formatPercent(p.profit.grossMargin)} />
            <Row label="Operating profit" metric="operatingProfit" period={period} value={money(p.profit.operatingProfit)} />
          </Block>
        </Stack>

        <Stack spacing={2}>
          <Block title="Costs">
            {categories.map(([k, v]) => (
              <Row key={k} indent label={CATEGORY_LABELS[k] ?? k} value={money(v)} />
            ))}
            <Row label="COGS" value={money(p.costs.cogs)} />
            <Row label="Operating expenses" metric="opex" period={period} value={money(p.costs.opex)} />
            <Row strong label="Total costs" value={money(p.costs.total)} />
          </Block>
          <MoreMetrics model={model} p={p} period={period} currency={currency} />
          <Block title="Customer movement">
            <Row label="Starting customers" value={formatCount(p.customers.opening)} />
            <Row label="New customers" metric="newCustomers" period={period} value={`+${formatCount(p.customers.new)}`} />
            <Row label="Churned" metric="churnedCustomers" period={period} value={`−${formatCount(p.customers.churned)}`} />
            <Row strong label="Ending customers" value={formatCount(p.customers.closing)} />
          </Block>
        </Stack>

        <Stack spacing={2}>
          <Block title="Cash">
            {hasCash ? (
              <>
                <Row label="Opening cash" value={money(p.cash.opening)} />
                <Row indent label="Cash in" value={`+${money(p.cash.inflow)}`} />
                <Row indent label="Cash out" value={`−${money(p.cash.outflow)}`} />
                <Row strong label="Closing cash" metric="cash" period={period} value={money(p.cash.closing)} />
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No Cash node in this model.
              </Typography>
            )}
            <Row label="Burn" metric="burn" period={period} value={(p.metrics.burn ?? 0) > 0 ? money(p.metrics.burn!) : "Not burning"} />
            <Row label="Runway" metric="runwayMonths" period={period} value={hasCash ? formatMonths(p.metrics.runwayMonths) : "—"} />
          </Block>
          {guardrails.length > 0 && (
            <Block title="Guardrails">
              {guardrails.map((g) => {
                const violated = result.guardrails.find((r) => r.guardrailId === g.id)?.violations.includes(period);
                return (
                  <Box key={g.id}>
                    <Row label={g.label} value={violated ? "⚠ not met" : "✓ met"} />
                    {violated && <GuardrailWhy model={model} result={result} guardrailId={g.id} period={period} />}
                  </Box>
                );
              })}
            </Block>
          )}
        </Stack>
      </Box>

      <Divider sx={{ my: 2 }} />
      <Accordion disableGutters elevation={0} sx={{ "&:before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            Every node value this period (audit trail)
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <Box sx={{ display: "grid", gap: 0.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            {model.nodes.map((n) => {
              const values = p.nodes[n.id];
              if (!values) return null;
              return (
                <Box key={n.id} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {n.label}
                  </Typography>
                  {Object.entries(values).map(([port, v]) => (
                    <Row key={port} indent label={port} value={formatByUnit(v, port === "utilization" ? "percent" : n.unit, currency)} />
                  ))}
                </Box>
              );
            })}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

function GuardrailWhy({ model, result, guardrailId, period }: { model: Model; result: SimulationResult; guardrailId: string; period: number }) {
  const [open, setOpen] = useState(false);
  const e = open ? explainGuardrail(model, result, guardrailId, period) : null;
  return (
    <Box sx={{ mb: 0.5 }}>
      <Link component="button" variant="caption" onClick={() => setOpen(!open)}>
        {open ? "Hide cause" : "Why?"}
      </Link>
      {e && (
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
          {e.headline} {e.cause} {e.details.join(" ")}
        </Typography>
      )}
    </Box>
  );
}

const EXTRA_METRICS = ["contribution", "contributionMargin", "newMrr", "nrr", "nrrAnnual", "cac", "cacPaybackMonths", "deferredRevenue", "creditBalance", "creditsBurned", "creditsExpired", "burnDepth", "breakageRate", "rationingRate"];

/** Metrics that only some models produce (credits, deferred revenue, NRR) plus the model's custom metrics. */
function MoreMetrics({ model, p, period, currency }: { model: Model; p: SimulationResult["timeline"][number]; period: number; currency: Currency }) {
  const keys = [...EXTRA_METRICS, ...model.customMetrics.map((c) => c.key)].filter((k) => p.metrics[k] !== null && p.metrics[k] !== undefined && !(k === "deferredRevenue" && p.metrics[k] === 0));
  if (keys.length === 0) return null;
  return (
    <Block title="Unit economics & credits">
      {keys.map((k) => {
        const def = getMetricDefinition(k, model.customMetrics);
        const cm = model.customMetrics.find((c) => c.key === k);
        return (
          <Row
            key={k}
            label={`${def?.label ?? k}${cm?.status === "needs_confirmation" ? " (unconfirmed)" : ""}`}
            metric={k}
            period={period}
            value={k === "cacPaybackMonths" ? formatMonths(p.metrics[k] ?? null, "—") : formatMetric(k, p.metrics[k], currency, model.customMetrics)}
          />
        );
      })}
    </Block>
  );
}
