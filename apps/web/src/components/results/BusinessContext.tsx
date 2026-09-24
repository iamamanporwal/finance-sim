"use client";

import { getMetricDefinition, type Model, type SimulationResult } from "@fin/model-schema";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { currentStateGaps, focusMetrics, GOALS, healthDimensions, STAGES, type Health } from "@/lib/business-context";
import { formatCount, formatCurrency, formatMetric, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";
import { MetricInfo } from "./MetricInfo";

const HEALTH_COLOR: Record<Health, string> = { healthy: tokens.positive, watch: tokens.warning, risk: tokens.risk, "n/a": "#94A3B8" };
const HEALTH_LABEL: Record<Health, string> = { healthy: "Healthy", watch: "Watch", risk: "At risk", "n/a": "n/a" };

function SectionLabel({ children, color }: { children: string; color: string }) {
  return (
    <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color }}>
      {children}
    </Typography>
  );
}

/** "Where am I now?" — the user's own numbers, visibly separate from the forecast. */
export function TodayPanel({ model, result }: { model: Model; result: SimulationResult }) {
  const openBusiness = useEditor((s) => s.openBusiness);
  const cs = model.currentState;
  const currency = model.settings.currency as Currency;
  const stage = model.metadata.stage;
  const gaps = currentStateGaps(model, result);
  const items = cs
    ? [
        { label: "MRR", value: cs.mrr, fmt: (v: number) => formatCurrency(v, currency) },
        { label: "Customers", value: cs.customers, fmt: (v: number) => formatCount(v) },
        { label: "Growth", value: cs.growth, fmt: (v: number) => `${formatPercent(v)}/mo` },
        { label: "Churn", value: cs.churn, fmt: (v: number) => `${formatPercent(v)}/mo` },
        { label: "Gross margin", value: cs.grossMargin, fmt: (v: number) => formatPercent(v) },
        { label: "Cash", value: cs.cash, fmt: (v: number) => formatCurrency(v, currency) },
        { label: "Monthly expenses", value: cs.monthlyExpenses, fmt: (v: number) => formatCurrency(v, currency) },
        {
          label: "Runway",
          value: cs.cash !== undefined && cs.monthlyExpenses !== undefined && cs.mrr !== undefined && cs.monthlyExpenses > cs.mrr ? cs.cash / (cs.monthlyExpenses - cs.mrr) : undefined,
          fmt: (v: number) => formatMonths(v),
          hint: "Cash ÷ (monthly expenses − MRR), from the numbers you entered.",
        },
      ].filter((i) => i.value !== undefined)
    : [];
  return (
    <Paper sx={{ p: 2, border: 1, borderColor: "divider", borderLeft: 4, borderLeftColor: tokens.info }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1, flexWrap: "wrap", gap: 1 }}>
        <SectionLabel color={tokens.info}>Current state · actual</SectionLabel>
        {cs && (
          <Typography variant="caption" color="text.secondary">
            as of {cs.asOf} · {cs.source === "imported" ? "imported" : "entered by you"}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={stage ? `Stage: ${STAGES[stage].label}` : "Stage not set"} variant="outlined" onClick={() => openBusiness("profile")} />
        <Button size="small" onClick={() => openBusiness("current")}>
          {cs ? "Edit" : "Add today's numbers"}
        </Button>
      </Stack>
      {cs && items.length > 0 ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {items.map((i) => (
            <Box key={i.label}>
              <Typography variant="caption" color="text.secondary" title={"hint" in i ? i.hint : undefined}>
                {i.label}
              </Typography>
              <Typography className="num" sx={{ fontWeight: 600, fontSize: 18 }}>
                {i.fmt(i.value!)}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Tell us where the business is today (MRR, customers, cash…) to see it next to the forecast and to start the forecast from reality.
        </Typography>
      )}
      {gaps.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }} action={<Button color="inherit" size="small" onClick={() => openBusiness("current")}>Fix</Button>}>
          {gaps.join(" ")}
        </Alert>
      )}
    </Paper>
  );
}

/** Stage focus, the founder's questions and per-dimension health — all read from the forecast. */
export function StageInsights({ model, result }: { model: Model; result: SimulationResult }) {
  const openWhy = useEditor((s) => s.openWhy);
  const openBusiness = useEditor((s) => s.openBusiness);
  const currency = model.settings.currency as Currency;
  const last = result.timeline[result.timeline.length - 1]!;
  const stage = model.metadata.stage;
  const focus = focusMetrics(model).filter((k) => getMetricDefinition(k, model.customMetrics) && k in last.metrics);
  const goals = GOALS.filter((g) => model.metadata.goals?.includes(g.id));
  const health = healthDimensions(result);
  const custom = model.customMetrics.filter((c) => last.metrics[c.key] !== undefined);
  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", lg: goals.length ? "1.2fr 1fr" : "1fr" } }}>
      <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
        <Stack direction="row" sx={{ alignItems: "baseline", mb: 1 }}>
          <Typography sx={{ fontWeight: 600, flex: 1 }}>{stage ? `What matters at ${STAGES[stage].label} stage` : "Model health"}</Typography>
          {!stage && (
            <Link component="button" variant="caption" onClick={() => openBusiness("profile")}>
              Set your stage
            </Link>
          )}
        </Stack>
        {stage && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {STAGES[stage].reading}
          </Typography>
        )}
        {(focus.length > 0 || custom.length > 0) && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2.5, mb: 2 }}>
            {[...focus, ...custom.map((c) => c.key)].map((k) => {
              const def = getMetricDefinition(k, model.customMetrics)!;
              const cm = model.customMetrics.find((c) => c.key === k);
              return (
                <Box key={k}>
                  <Typography variant="caption" color="text.secondary">
                    {def.label}
                    <MetricInfo text={def.description} />
                    {cm?.status === "needs_confirmation" && (
                      <Tooltip title="Placeholder definition — confirm it under Your business → Custom metrics.">
                        <Chip size="small" label="unconfirmed" color="warning" variant="outlined" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
                      </Tooltip>
                    )}
                  </Typography>
                  <Typography className="num" sx={{ fontWeight: 600 }}>
                    <Link component="button" underline="hover" color="inherit" onClick={() => openWhy({ metric: k }, last.index)} sx={{ font: "inherit" }} aria-label={`Why is ${def.label} this value?`}>
                      {k === "cacPaybackMonths" ? formatMonths(last.metrics[k] ?? null, "—") : formatMetric(k, last.metrics[k] ?? null, currency, model.customMetrics)}
                    </Link>
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }} aria-label="Health by dimension">
          {health.map((h) => (
            <Tooltip key={h.dimension} title={`Rule of thumb: ${h.rule}`}>
              <Box sx={{ p: 1, borderRadius: 1, border: 1, borderColor: "divider", borderLeft: 3, borderLeftColor: HEALTH_COLOR[h.status] }}>
                <Typography variant="caption" color="text.secondary">
                  {h.dimension}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: HEALTH_COLOR[h.status] }}>
                  {HEALTH_LABEL[h.status]}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {h.detail}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
      </Paper>
      {goals.length > 0 && (
        <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>Your questions</Typography>
          <Stack spacing={1.25}>
            {goals.map((g) => (
              <Box key={g.id}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {g.label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {g.answer(result, currency)}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Answers come from the simulation, not a prediction.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

