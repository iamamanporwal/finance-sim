"use client";

import { generateReport, reportToMarkdown, type ReportTable } from "@fin/reports";
import { compareScenarios, runSensitivity } from "@fin/simulation-engine";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PrintIcon from "@mui/icons-material/Print";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { Fragment, useMemo } from "react";
import { useEditor } from "@/store/editor-store";

/** The report is generated from engine data only. AI never writes these numbers. */
export function ReportView() {
  const model = useEditor((s) => s.model)!;
  const result = useEditor((s) => s.result);
  const stale = useEditor((s) => s.stale);
  const simStatus = useEditor((s) => s.simStatus);
  const activeScenarioId = useEditor((s) => s.activeScenarioId);
  const mc = useEditor((s) => s.monteCarlo);
  const sens = useEditor((s) => s.sensitivity);
  const setResultsTab = useEditor((s) => s.setResultsTab);
  const notify = useEditor((s) => s.notify);

  const report = useMemo(() => {
    if (!result || simStatus !== "ok") return null;
    const sensitivity =
      sens.result && sens.model === model
        ? sens.result
        : (() => {
            try {
              return runSensitivity(model, { metric: "mrr", scenarioId: activeScenarioId ?? undefined });
            } catch {
              return null;
            }
          })();
    const scenarios = model.scenarios.length ? compareScenarios(model, [null, ...model.scenarios.map((s) => s.id)]) : null;
    const monteCarlo = mc.result && mc.model === model && mc.scenarioId === activeScenarioId ? mc.result : null;
    return generateReport({ model, result, sensitivity, scenarios, monteCarlo });
  }, [model, result, simStatus, sens, mc, activeScenarioId]);

  if (!report) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
        <Alert severity="info">Run a successful simulation to generate the report.</Alert>
      </Box>
    );
  }
  const scenarioName = activeScenarioId ? model.scenarios.find((s) => s.id === activeScenarioId)?.name : null;
  const mcIncluded = !report.sections.find((s) => s.kind === "monte_carlo")!.body.startsWith("Monte Carlo simulation has not been run");

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: "auto" }}>
      <Stack direction="row" spacing={1} className="no-print" sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
        <Button
          variant="outlined"
          startIcon={<ContentCopyIcon />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(reportToMarkdown(report));
              notify("Report copied as Markdown.", "success");
            } catch {
              notify("Could not access the clipboard.", "error");
            }
          }}
        >
          Copy as Markdown
        </Button>
        {!mcIncluded && (
          <Button onClick={() => setResultsTab("risk")}>Add Monte Carlo results…</Button>
        )}
      </Stack>
      {stale && <Alert severity="info" className="no-print" sx={{ mb: 2 }}>The model changed; the report updates after the next successful run.</Alert>}

      <Paper sx={{ p: { xs: 2, md: 5 }, border: 1, borderColor: "divider" }}>
        <Typography variant="h1">{report.title}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 3, flexWrap: "wrap", gap: 1 }}>
          <Chip size="small" label="Forecast" variant="outlined" />
          {scenarioName && <Chip size="small" color="secondary" label={`Scenario: ${scenarioName}`} />}
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
            Generated {new Date(report.createdAt).toLocaleString()} · model v{report.modelVersion} · seed {result!.seed}
          </Typography>
        </Stack>
        {report.sections.map((s) => {
          const table = (s.data as { table?: ReportTable } | undefined)?.table;
          return (
            <Box key={s.id} component="section" sx={{ mb: 4, breakInside: "avoid" }}>
              <Typography variant="h2" sx={{ mb: 1 }}>
                {s.title}
              </Typography>
              <Body text={s.body} />
              {table && table.rows.length > 0 && (
                <Box sx={{ overflowX: "auto", mt: 1.5 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {table.columns.map((c, i) => (
                          <TableCell key={c + i} align={i ? "right" : "left"} sx={{ fontWeight: 600 }}>
                            {c}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {table.rows.map((r, i) => (
                        <TableRow key={i}>
                          {r.map((cell, j) => (
                            <TableCell key={j} align={j ? "right" : "left"} className="num">
                              {cell}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>
          );
        })}
      </Paper>
    </Box>
  );
}

/** Paragraphs and "- " bullet lists; rendered as text (never as HTML). */
function Body({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <Box key={i} component="ul" sx={{ pl: 3, my: 1 }}>
              {lines.map((l, j) => (
                <Typography key={j} component="li" sx={{ mb: 0.5 }}>
                  {l.slice(2)}
                </Typography>
              ))}
            </Box>
          );
        }
        return (
          <Fragment key={i}>
            <Typography sx={{ mb: 1, lineHeight: 1.7 }}>{b}</Typography>
          </Fragment>
        );
      })}
    </>
  );
}
