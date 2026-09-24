"use client";

import { assumptionsCsv, fileSlug, generateReport, modelJson, monteCarloCsv, nodeValuesCsv, reportMarkdown, resultsJson, scenariosCsv, timelineCsv } from "@fin/reports";
import { compareScenarios, runSensitivity } from "@fin/simulation-engine";
import DownloadIcon from "@mui/icons-material/Download";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEditor } from "@/store/editor-store";

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const JSON_TYPE = "application/json";
const CSV_TYPE = "text/csv;charset=utf-8";

/** Model, assumptions, timeline, results, scenarios, Monte Carlo and report — JSON, CSV or PDF. */
export default function ExportDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const model = useEditor((s) => s.model)!;
  const result = useEditor((s) => s.result);
  const simStatus = useEditor((s) => s.simStatus);
  const mc = useEditor((s) => s.monteCarlo);
  const activeScenarioId = useEditor((s) => s.activeScenarioId);
  const setMode = useEditor((s) => s.setMode);
  const notify = useEditor((s) => s.notify);
  const base = `${fileSlug(model.name)}-v${model.version}`;
  const hasResult = !!result && simStatus === "ok";
  const mcResult = mc.result && mc.model === model ? mc.result : null;
  const scenarioSuffix = activeScenarioId ? `-${fileSlug(model.scenarios.find((s) => s.id === activeScenarioId)?.name ?? "scenario")}` : "";

  const save = (name: string, text: string, type: string) => {
    try {
      download(name, text, type);
      notify(`Downloaded ${name}`, "success");
    } catch (e) {
      notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  const items: { what: string; detail: string; actions: { label: string; disabled?: boolean; run(): void }[] }[] = [
    { what: "Model", detail: "Graph, assumptions, scenarios, guardrails, settings and seed. Re-importable.", actions: [{ label: "JSON", run: () => save(`${base}.json`, modelJson(model), JSON_TYPE) }] },
    { what: "Assumptions", detail: "Every assumption with its source, confidence and uncertainty.", actions: [{ label: "CSV", run: () => save(`${base}-assumptions.csv`, assumptionsCsv(model), CSV_TYPE) }] },
    {
      what: "Timeline",
      detail: `Statements and all metrics per period${activeScenarioId ? " (active scenario)" : ""}; plus every node's value (audit trail).`,
      actions: [
        { label: "CSV", disabled: !hasResult, run: () => save(`${base}${scenarioSuffix}-timeline.csv`, timelineCsv(model, result!), CSV_TYPE) },
        { label: "Node values CSV", disabled: !hasResult, run: () => save(`${base}${scenarioSuffix}-node-values.csv`, nodeValuesCsv(model, result!), CSV_TYPE) },
      ],
    },
    { what: "Results", detail: "Summary, events, guardrails and the full timeline with run ID and seed.", actions: [{ label: "JSON", disabled: !hasResult, run: () => save(`${base}${scenarioSuffix}-results.json`, resultsJson(model, result!), JSON_TYPE) }] },
    {
      what: "Scenarios",
      detail: `${model.scenarios.length} scenario${model.scenarios.length === 1 ? "" : "s"}: their overrides and results compared with the base model.`,
      actions: [{ label: "CSV", disabled: !hasResult, run: () => save(`${base}-scenarios.csv`, scenariosCsv(model, compareScenarios(model, [null, ...model.scenarios.map((s) => s.id)])), CSV_TYPE) }],
    },
    {
      what: "Monte Carlo",
      detail: mcResult ? `${mcResult.completed.toLocaleString()} runs, seed ${mcResult.seed}.` : "Run Monte Carlo (Results → Risk & uncertainty) first.",
      actions: [
        { label: "CSV", disabled: !mcResult, run: () => save(`${base}-monte-carlo.csv`, monteCarloCsv(mcResult!), CSV_TYPE) },
        { label: "JSON", disabled: !mcResult, run: () => save(`${base}-monte-carlo.json`, JSON.stringify(mcResult, null, 2), JSON_TYPE) },
      ],
    },
    {
      what: "Report",
      detail: "The simulation report, generated from engine output.",
      actions: [
        {
          label: "Markdown",
          disabled: !hasResult,
          run: () => {
            let sensitivity = null;
            try {
              sensitivity = runSensitivity(model, { metric: "mrr", scenarioId: activeScenarioId ?? undefined });
            } catch {
              sensitivity = null;
            }
            const scenarios = model.scenarios.length ? compareScenarios(model, [null, ...model.scenarios.map((s) => s.id)]) : null;
            save(`${base}-report.md`, reportMarkdown(generateReport({ model, result: result!, sensitivity, scenarios, monteCarlo: mcResult && mc.scenarioId === activeScenarioId ? mcResult : null })), "text/markdown;charset=utf-8");
          },
        },
        {
          label: "PDF",
          disabled: !hasResult,
          run: () => {
            onClose();
            setMode("report");
            // Let the report render, then open the print dialog ("Save as PDF").
            setTimeout(() => window.print(), 400);
          },
        },
      ],
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="export-title">
      <DialogTitle id="export-title">Export</DialogTitle>
      <DialogContent>
        {!hasResult && <Alert severity="info" sx={{ mb: 1 }}>Run a successful simulation to export results, scenarios and the report.</Alert>}
        <List dense disablePadding>
          {items.map((it) => (
            <ListItem key={it.what} divider sx={{ px: 0, alignItems: "flex-start", gap: 2 }}>
              <ListItemText primary={it.what} secondary={it.detail} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, pt: 0.5 }}>
                {it.actions.map((a) => (
                  <Button key={a.label} size="small" variant="outlined" disabled={a.disabled} startIcon={a.label === "PDF" ? <PictureAsPdfOutlinedIcon /> : <DownloadIcon />} onClick={a.run}>
                    {a.label}
                  </Button>
                ))}
              </Stack>
            </ListItem>
          ))}
        </List>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Files contain raw numbers (percentages as fractions). Text cells that start with =, +, − or @ are prefixed with &apos; so spreadsheets never run them as formulas.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
