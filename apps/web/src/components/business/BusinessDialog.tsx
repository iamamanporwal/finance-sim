"use client";

import { ACTUAL_FIELDS, BUSINESS_STAGES, METRIC_DEFINITIONS, outputsFor, type ActualPoint, type BusinessStage, type CurrentState, type CustomMetric, type Model } from "@fin/model-schema";
import { addMonths, parseActualsCsv } from "@fin/simulation-engine";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { NumberInput, TextInput } from "@/components/workspace/NumberInput";
import { BUSINESS_TYPES, GOALS, REVENUE_MODELS, STAGES, startingPointFromActuals, startingPointFromCurrentState, type StartingPointChange } from "@/lib/business-context";
import { useEditor, type BusinessTab } from "@/store/editor-store";

const FIELD_LABELS: Record<(typeof ACTUAL_FIELDS)[number], string> = {
  revenue: "Revenue",
  mrr: "MRR",
  customers: "Customers",
  newCustomers: "New customers",
  churnedCustomers: "Churned",
  cogs: "COGS",
  opex: "Operating expenses",
  cash: "Cash",
};

/** The business behind the model: stage and goals, where it is today, and what actually happened. */
export default function BusinessDialog() {
  const tab = useEditor((s) => s.businessTab);
  const setTab = useEditor((s) => s.openBusiness);
  const close = useEditor((s) => s.closeBusiness);
  if (!tab) return null;
  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth aria-labelledby="business-title">
      <DialogTitle id="business-title" sx={{ pb: 0 }}>
        Your business
      </DialogTitle>
      <Tabs value={tab} onChange={(_, v: BusinessTab) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="profile" label="Stage & goals" />
        <Tab value="current" label="Current state" />
        <Tab value="actuals" label="Actuals" />
        <Tab value="metrics" label="Custom metrics" />
      </Tabs>
      <DialogContent sx={{ minHeight: 420 }}>
        {tab === "profile" && <ProfileTab />}
        {tab === "current" && <CurrentStateTab />}
        {tab === "actuals" && <ActualsTab />}
        {tab === "metrics" && <MetricsTab />}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

function ProfileTab() {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const meta = model.metadata;
  const setMeta = (patch: Partial<Model["metadata"]>) => apply((m) => ({ ...m, metadata: { ...m.metadata, ...patch } }), { structural: false });
  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField select size="small" fullWidth label="Stage" value={meta.stage ?? ""} onChange={(e) => setMeta({ stage: (e.target.value || undefined) as BusinessStage | undefined })}>
          <MenuItem value="">Not set</MenuItem>
          {BUSINESS_STAGES.map((s) => (
            <MenuItem key={s} value={s}>
              {STAGES[s].label} — {STAGES[s].description}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" fullWidth label="What you are building" value={meta.businessType ?? ""} onChange={(e) => setMeta({ businessType: e.target.value || undefined })}>
          <MenuItem value="">Not set</MenuItem>
          {BUSINESS_TYPES.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" fullWidth label="How you make money" value={meta.revenueModel ?? ""} onChange={(e) => setMeta({ revenueModel: e.target.value || undefined })}>
          <MenuItem value="">Not set</MenuItem>
          {REVENUE_MODELS.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))}
          {meta.revenueModel && !REVENUE_MODELS.some((r) => r.id === meta.revenueModel) && <MenuItem value={meta.revenueModel}>{meta.revenueModel}</MenuItem>}
        </TextField>
      </Stack>
      {meta.stage && (
        <Alert severity="info" icon={false}>
          <b>{STAGES[meta.stage].label}:</b> {STAGES[meta.stage].reading} Stage changes what the dashboard shows first — never the calculations.
        </Alert>
      )}
      <Box>
        <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Your biggest questions</Typography>
        <Typography variant="body2" color="text.secondary">
          Answered on the Results overview from the simulation.
        </Typography>
        {GOALS.map((g) => (
          <FormControlLabel
            key={g.id}
            sx={{ display: "flex" }}
            control={<Checkbox size="small" checked={meta.goals?.includes(g.id) ?? false} onChange={(e) => setMeta({ goals: e.target.checked ? [...(meta.goals ?? []), g.id] : (meta.goals ?? []).filter((x) => x !== g.id) })} />}
            label={g.label}
          />
        ))}
      </Box>
    </Stack>
  );
}

function ChangesSummary({ result }: { result: { changes: StartingPointChange[]; skipped: string[] } | null }) {
  if (!result) return null;
  return (
    <Alert severity={result.changes.length ? "success" : "info"}>
      {result.changes.length ? (
        <>
          Forecast starting point updated (undo with ⌘Z):
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {result.changes.map((c) => (
              <li key={c.what}>
                {c.what}: {c.from} → {c.to}
              </li>
            ))}
          </ul>
        </>
      ) : (
        "Nothing needed to change."
      )}
      {result.skipped.map((s) => (
        <div key={s}>{s}</div>
      ))}
    </Alert>
  );
}

function CurrentStateTab() {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const [applied, setApplied] = useState<{ changes: StartingPointChange[]; skipped: string[] } | null>(null);
  const cs: CurrentState = model.currentState ?? { asOf: thisMonth(), source: "user" };
  const set = (patch: Partial<CurrentState>) => apply((m) => ({ ...m, currentState: { ...cs, ...patch } }));
  const money = model.settings.currency === "INR" ? "₹" : "$";
  const num = (key: "mrr" | "customers" | "cash" | "monthlyExpenses", label: string, prefix?: string) => (
    <NumberInput size="small" fullWidth label={label} value={cs[key]} prefix={prefix} onCommit={(v) => set({ [key]: v })} />
  );
  const pct = (key: "growth" | "churn" | "grossMargin", label: string) => <NumberInput size="small" fullWidth label={label} value={cs[key]} scale={100} suffix="%" onCommit={(v) => set({ [key]: v })} />;
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body2" color="text.secondary">
        Where the business is today. These are facts you enter (actuals), shown separately from the forecast and never produced by the simulation.
      </Typography>
      <TextInput label="As of (YYYY-MM)" size="small" value={cs.asOf} onCommit={(v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && set({ asOf: v })} sx={{ maxWidth: 200 }} />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
        {num("mrr", "Current MRR", money)}
        {num("customers", "Current customers")}
        {num("cash", "Current cash", money)}
        {pct("growth", "Monthly growth")}
        {pct("churn", "Monthly churn")}
        {num("monthlyExpenses", "Monthly expenses", money)}
        {pct("grossMargin", "Gross margin")}
      </Box>
      <Divider />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Button variant="outlined" disabled={cs.customers === undefined && cs.cash === undefined} onClick={() => {
          const r = startingPointFromCurrentState(model, cs);
          if (r.changes.length) apply(() => r.model);
          setApplied(r);
        }}>
          Start the forecast from today
        </Button>
        <Typography variant="caption" color="text.secondary">
          Sets starting customers and cash to today&apos;s values and starts the forecast next month.
        </Typography>
        {model.currentState && (
          <Button color="error" size="small" onClick={() => apply((m) => ({ ...m, currentState: undefined }))}>
            Clear
          </Button>
        )}
      </Stack>
      <ChangesSummary result={applied} />
    </Stack>
  );
}

function ActualsTab() {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const [paste, setPaste] = useState("");
  const [pasteResult, setPasteResult] = useState<{ added: number; errors: string[] } | null>(null);
  const [applied, setApplied] = useState<{ changes: StartingPointChange[]; skipped: string[] } | null>(null);
  const actuals = [...model.actuals].sort((a, b) => a.period.localeCompare(b.period));
  const money = model.settings.currency === "INR" ? "₹" : "$";
  const setActuals = (next: ActualPoint[]) => apply((m) => ({ ...m, actuals: next }));
  const setValue = (period: string, field: (typeof ACTUAL_FIELDS)[number], v: number | undefined) =>
    setActuals(model.actuals.map((a) => (a.period === period ? { ...a, values: { ...a.values, [field]: v } } : a)));
  const addMonth = () => {
    const last = actuals[actuals.length - 1]?.period ?? addMonths(model.settings.startDate.slice(0, 7), -1);
    const next = actuals.length ? addMonths(last, 1) : last;
    if (!model.actuals.some((a) => a.period === next)) setActuals([...model.actuals, { period: next, values: {} }]);
  };
  const importPaste = () => {
    const { rows, errors } = parseActualsCsv(paste);
    if (rows.length) {
      const byPeriod = new Map(model.actuals.map((a) => [a.period, a]));
      for (const r of rows) byPeriod.set(r.period, { period: r.period, values: { ...(byPeriod.get(r.period)?.values ?? {}), ...r.values } });
      setActuals([...byPeriod.values()]);
      setPaste("");
    }
    setPasteResult({ added: rows.length, errors });
  };
  const start = model.settings.startDate.slice(0, 7);
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body2" color="text.secondary">
        What actually happened, month by month. Months before the forecast start appear as history (A); months inside the forecast are compared with what the model predicted.
      </Typography>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small" aria-label="Actuals">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Month</TableCell>
              {ACTUAL_FIELDS.map((f) => (
                <TableCell key={f} sx={{ fontWeight: 600, minWidth: 110 }}>
                  {FIELD_LABELS[f]}
                </TableCell>
              ))}
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {actuals.map((a) => (
              <TableRow key={a.period}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {a.period} <Chip size="small" label={a.period < start ? "A" : "A vs F"} sx={{ height: 18, fontSize: 10 }} />
                </TableCell>
                {ACTUAL_FIELDS.map((f) => (
                  <TableCell key={f} sx={{ p: 0.5 }}>
                    <NumberInput size="small" value={a.values[f]} prefix={["customers", "newCustomers", "churnedCustomers"].includes(f) ? undefined : money} onCommit={(v) => setValue(a.period, f, v)} slotProps={{ htmlInput: { "aria-label": `${FIELD_LABELS[f]} ${a.period}` } }} />
                  </TableCell>
                ))}
                <TableCell sx={{ p: 0 }}>
                  <IconButton size="small" aria-label={`Delete ${a.period}`} onClick={() => setActuals(model.actuals.filter((x) => x.period !== a.period))}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {actuals.length === 0 && (
              <TableRow>
                <TableCell colSpan={ACTUAL_FIELDS.length + 2}>
                  <Typography variant="body2" color="text.secondary">
                    No actuals yet. Add a month or paste from a spreadsheet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
      <Stack direction="row" spacing={1}>
        <Button startIcon={<AddIcon />} onClick={addMonth}>
          Add month
        </Button>
        <Button variant="outlined" disabled={actuals.length === 0} onClick={() => {
          const r = startingPointFromActuals(model);
          if (r.changes.length) apply(() => r.model);
          setApplied(r);
        }}>
          Start the forecast after the latest actuals
        </Button>
      </Stack>
      <ChangesSummary result={applied} />
      <Divider />
      <TextField
        multiline
        minRows={3}
        label="Paste from a spreadsheet or CSV"
        placeholder={"month,mrr,customers,cash\n2026-06,12400,310,1200000"}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        slotProps={{ htmlInput: { maxLength: 200_000 } }}
      />
      <Box>
        <Button variant="outlined" disabled={!paste.trim()} onClick={importPaste}>
          Import rows
        </Button>
      </Box>
      {pasteResult && (
        <Alert severity={pasteResult.errors.length ? "warning" : "success"}>
          Imported {pasteResult.added} month{pasteResult.added === 1 ? "" : "s"}.
          {pasteResult.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      )}
    </Stack>
  );
}

function MetricsTab() {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const validation = useEditor((s) => s.validation);
  const update = (key: string, patch: Partial<CustomMetric>) => apply((m) => ({ ...m, customMetrics: m.customMetrics.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const add = () => {
    let i = model.customMetrics.length + 1;
    while (model.customMetrics.some((c) => c.key === `metric${i}`)) i++;
    apply((m) => ({ ...m, customMetrics: [...m.customMetrics, { key: `metric${i}`, label: `Custom metric ${i}`, description: "", unit: "number", expression: "a / b", inputs: { a: { metric: "revenue" }, b: { metric: "customers" } }, status: "confirmed" }] }));
  };
  const sources = [
    ...METRIC_DEFINITIONS.map((d) => ({ value: `metric:${d.key}`, label: `Metric · ${d.label}` })),
    ...model.nodes.flatMap((n) => outputsFor(n).map((o) => ({ value: `node:${n.id}:${o.name}`, label: `${n.label} · ${o.label}` }))),
  ];
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body2" color="text.secondary">
        Metrics defined by a formula over other metrics or node values. They are calculated by the engine every period and can be used in guardrails.
      </Typography>
      {model.customMetrics.map((c, idx) => {
        const issues = validation?.issues.filter((i) => i.message.startsWith(`Custom metric "${c.label}"`) && i.code !== "unconfirmed-metric") ?? [];
        const vars = Object.keys(c.inputs);
        return (
          <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <TextInput size="small" label="Name" value={c.label} onCommit={(label) => label && update(c.key, { label })} sx={{ flex: 1 }} />
                <TextField select size="small" label="Unit" value={c.unit} onChange={(e) => update(c.key, { unit: e.target.value as CustomMetric["unit"] })} sx={{ width: 140 }}>
                  {["number", "currency", "percent", "count", "months"].map((u) => (
                    <MenuItem key={u} value={u}>
                      {u}
                    </MenuItem>
                  ))}
                </TextField>
                {c.status === "needs_confirmation" ? (
                  <Button size="small" variant="contained" color="warning" onClick={() => update(c.key, { status: "confirmed" })}>
                    Confirm definition
                  </Button>
                ) : (
                  <Chip size="small" color="success" variant="outlined" label="Confirmed" />
                )}
                <IconButton aria-label={`Delete ${c.label}`} onClick={() => apply((m) => ({ ...m, customMetrics: m.customMetrics.filter((x) => x.key !== c.key) }))}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
              {c.status === "needs_confirmation" && <Alert severity="warning">{c.description || "This definition is a placeholder and has not been confirmed."}</Alert>}
              <TextInput size="small" label="Formula" value={c.expression} onCommit={(expression) => {
                if (!expression) return;
                // Keep existing links; new variables start unlinked (validation lists them).
                update(c.key, { expression });
              }} slotProps={{ htmlInput: { style: { fontFamily: "ui-monospace, Menlo, monospace" } } }} />
              {vars.map((v) => {
                const input = c.inputs[v]!;
                const value = "metric" in input ? `metric:${input.metric}` : `node:${input.nodeId}:${input.port}`;
                return (
                  <Stack key={v} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography sx={{ fontFamily: "ui-monospace, Menlo, monospace", width: 100 }}>{v} =</Typography>
                    <TextField select size="small" fullWidth value={sources.some((s) => s.value === value) ? value : ""} onChange={(e) => {
                      const [kind, a, b] = e.target.value.split(":");
                      update(c.key, { inputs: { ...c.inputs, [v]: kind === "metric" ? { metric: a! } : { nodeId: a!, port: b! } } });
                    }}>
                      {sources.map((s) => (
                        <MenuItem key={s.value} value={s.value}>
                          {s.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                );
              })}
              <MissingVariables metric={c} onLink={(v) => update(c.key, { inputs: { ...c.inputs, [v]: { metric: "revenue" } } })} />
              {issues.map((i) => (
                <Alert key={i.message} severity="error">
                  {i.message}
                </Alert>
              ))}
            </Stack>
          </Paper>
        );
      })}
      <Box>
        <Button startIcon={<AddIcon />} onClick={add}>
          Add custom metric
        </Button>
      </Box>
    </Stack>
  );
}

function MissingVariables({ metric, onLink }: { metric: CustomMetric; onLink(v: string): void }) {
  const names = [...new Set(metric.expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])].filter((n) => !metric.inputs[n] && !/^(min|max|sum|average|abs|round|floor|ceil|sqrt|pow|mod|if|and|or|not|previous|lag|growth|period)$/.test(n));
  if (!names.length) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Typography variant="body2" color="text.secondary">
        Link:
      </Typography>
      {names.map((n) => (
        <Chip key={n} label={n} size="small" onClick={() => onLink(n)} />
      ))}
    </Stack>
  );
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
