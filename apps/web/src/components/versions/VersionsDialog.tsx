"use client";

import { diffModels, type ModelVersion, type SimulationSummary } from "@fin/model-schema";
import { simulate, validateForSimulation } from "@fin/simulation-engine";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatByUnit, formatCount, formatCurrency, formatMonths, formatPercent, type Currency } from "@/lib/format";
import { browserVersionStore, saveModel } from "@/lib/storage";
import { duplicateFromVersion } from "@/lib/versions";
import { useEditor } from "@/store/editor-store";

const KIND_LABEL: Record<ModelVersion["kind"], string> = { manual: "Saved", auto: "Autosave", restore: "Restore", import: "Import" };

/** Version history: compare, restore, duplicate. */
export default function VersionsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const model = useEditor((s) => s.model)!;
  const dirty = useEditor((s) => s.saveState.dirty);
  const save = useEditor((s) => s.save);
  const restore = useEditor((s) => s.restoreVersion);
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [refresh, setRefresh] = useState(0);
  const versions = useMemo(() => [...browserVersionStore.read(model.id)].sort((a, b) => b.version - a.version), [model.id, refresh, open]);
  const currency = model.settings.currency as Currency;
  const byNumber = new Map(versions.map((v) => [v.version, v]));
  const [a, b] = [...picked].sort((x, y) => x - y).map((n) => byNumber.get(n));

  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="versions-title">
      <DialogTitle id="versions-title">Version history</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
          <TextField size="small" label="Version name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 120 } }} />
          <Button
            variant="contained"
            onClick={() => {
              save({ version: "manual", label });
              setLabel("");
              setRefresh((r) => r + 1);
            }}
          >
            Save version
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Each version stores the graph, assumptions, scenarios, settings and seed, so its results can be reproduced exactly. ⌘S saves a version; autosave adds one at most every 10 minutes. Select two versions to compare.
          {dirty ? " You have unsaved changes." : ""}
        </Typography>
        {versions.length === 0 ? (
          <Alert severity="info">No versions yet. Save one to start the history.</Alert>
        ) : (
          <Paper variant="outlined" sx={{ maxHeight: 300, overflowY: "auto" }}>
            <Table size="small" stickyHeader aria-label="Versions">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Version</TableCell>
                  <TableCell>Saved</TableCell>
                  <TableCell align="right">MRR (end)</TableCell>
                  <TableCell align="right">Cash (end)</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id} selected={picked.includes(v.version)} hover>
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={picked.includes(v.version)} onChange={() => toggle(v.version)} slotProps={{ input: { "aria-label": `Select v${v.version}` } }} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          v{v.version}
                        </Typography>
                        <Chip size="small" label={KIND_LABEL[v.kind]} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                        {v.version === model.version && <Chip size="small" label="current" color="primary" variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
                        {v.label && (
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 180 }}>
                            {v.label}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{new Date(v.createdAt).toLocaleString()}</Typography>
                    </TableCell>
                    <TableCell align="right" className="num">
                      {v.summary ? formatCurrency(v.summary.mrr, currency) : "—"}
                    </TableCell>
                    <TableCell align="right" className="num">
                      {v.summary?.cash !== null && v.summary?.cash !== undefined ? formatCurrency(v.summary.cash, currency) : "—"}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Button
                        size="small"
                        onClick={() => {
                          restore(v);
                          setRefresh((r) => r + 1);
                        }}
                      >
                        Restore
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          const copy = duplicateFromVersion(v);
                          saveModel(copy);
                          onClose();
                          router.push(`/app/models/${copy.id}`);
                        }}
                      >
                        Duplicate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
        {a && b && <Comparison a={a} b={b} currency={currency} />}
        {picked.length === 1 && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Select one more version to compare.</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function runSummary(v: ModelVersion): SimulationSummary | null {
  if (v.summary) return v.summary;
  try {
    return validateForSimulation(v.snapshot).valid ? simulate(v.snapshot).summary : null;
  } catch {
    return null;
  }
}

function Comparison({ a, b, currency }: { a: ModelVersion; b: ModelVersion; currency: Currency }) {
  const d = useMemo(() => diffModels(a.snapshot, b.snapshot), [a, b]);
  const [sa, sb] = [runSummary(a), runSummary(b)];
  const fmtParam = (v: number | string | null, unit?: string) => (typeof v === "number" ? formatByUnit(v, unit, currency) : v ?? "—");
  const structure = [
    ...d.nodes.added.map((n) => `Added node ${n}`),
    ...d.nodes.removed.map((n) => `Removed node ${n}`),
    ...d.nodes.changed.map((n) => `Changed node ${n}`),
    ...(d.connections.added ? [`${d.connections.added} connection(s) added`] : []),
    ...(d.connections.removed ? [`${d.connections.removed} connection(s) removed`] : []),
    ...d.scenarios.added.map((n) => `Added scenario ${n}`),
    ...d.scenarios.removed.map((n) => `Removed scenario ${n}`),
    ...d.scenarios.changed.map((n) => `Changed scenario ${n}`),
    ...d.guardrails.added.map((n) => `Added guardrail ${n}`),
    ...d.guardrails.removed.map((n) => `Removed guardrail ${n}`),
    ...d.customMetrics.changed.map((n) => `Changed metric ${n}`),
    ...d.settings.map((s) => `${s.name}: ${s.from} → ${s.to}`),
    ...d.parameters.added.map((p) => `Added assumption ${p.name} (${fmtParam(p.to, p.unit)})`),
    ...d.parameters.removed.map((p) => `Removed assumption ${p.name}`),
  ];
  const rows: [string, (s: SimulationSummary) => string][] = [
    ["MRR", (s) => formatCurrency(s.mrr, currency)],
    ["Customers", (s) => formatCount(s.customers)],
    ["Gross margin", (s) => formatPercent(s.grossMargin)],
    ["Cash", (s) => (s.cash === null ? "—" : formatCurrency(s.cash, currency))],
    ["Runway", (s) => formatMonths(s.runwayMonths)],
    ["Break-even", (s) => (s.breakEvenPeriod ? `period ${s.breakEvenPeriod}` : "not reached")],
  ];
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }} aria-label={`Compare v${a.version} and v${b.version}`}>
      <Typography sx={{ fontWeight: 600, mb: 1 }}>
        v{a.version} → v{b.version}
      </Typography>
      {d.identical ? (
        <Typography variant="body2" color="text.secondary">
          No differences that affect the model.
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <Box>
            {d.parameters.changed.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  ASSUMPTIONS
                </Typography>
                {d.parameters.changed.map((c) => (
                  <Typography key={c.id} variant="body2" className="num">
                    {c.name}: {fmtParam(c.from, c.unit)} → <b>{fmtParam(c.to, c.unit)}</b>
                  </Typography>
                ))}
              </>
            )}
            {structure.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: "block", mt: 1 }}>
                  STRUCTURE & SETTINGS
                </Typography>
                {structure.map((s) => (
                  <Typography key={s} variant="body2">
                    {s}
                  </Typography>
                ))}
              </>
            )}
          </Box>
          {sa && sb && (
            <Table size="small" aria-label="Results by version">
              <TableHead>
                <TableRow>
                  <TableCell>Result (end of forecast)</TableCell>
                  <TableCell align="right">v{a.version}</TableCell>
                  <TableCell align="right">v{b.version}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(([label, f]) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    <TableCell align="right" className="num">
                      {f(sa)}
                    </TableCell>
                    <TableCell align="right" className="num" sx={{ fontWeight: f(sa) === f(sb) ? 400 : 600 }}>
                      {f(sb)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      )}
    </Paper>
  );
}
