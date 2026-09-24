"use client";

import type { RepairAttempt } from "@fin/ai";
import type { Model } from "@fin/model-schema";
import { validateForSimulation } from "@fin/simulation-engine";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { buildModelFromAssumptions } from "@/ai/builder";
import { ASSUMPTIONS, missingEssentials, type AssumptionKey, type BusinessSpec, type ExtractedAssumption } from "@/ai/business-spec";
import { extractBusinessSpec } from "@/ai/generator";
import { reviewModel } from "@/ai/review";
import { createProvider, effectiveModel, useAIStatus } from "@/lib/ai-client";
import { NumberInput, unitPresentation } from "../workspace/NumberInput";
import { AIStatusNotice, SettingsLink } from "./AIStatusNotice";

type Row = { key: AssumptionKey; value?: number; include: boolean; source: "user" | "ai" | "missing"; confidence?: ExtractedAssumption["confidence"]; evidence?: string };
type Step = { kind: "describe" } | { kind: "analyzing"; attempts: RepairAttempt[] } | { kind: "review"; spec: BusinessSpec };

const EXAMPLE = "I run a $39/month AI SaaS. We have 1,000 visitors per month growing 15% monthly, 7% convert to paid, churn is 5% a month and it costs about $8 per customer per month to serve. Two founders paid $12k/month in total, $3k/month other costs, $400k in the bank.";

export function DescribeBusinessDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(model: Model): void }) {
  const { status, loading, refresh } = useAIStatus();
  const [description, setDescription] = useState("");
  const [step, setStep] = useState<Step>({ kind: "describe" });
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const model = effectiveModel(status);
  const aiReady = !!status?.reachable && !!model;

  const analyze = async () => {
    setError(null);
    setBuildErrors([]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const attempts: RepairAttempt[] = [];
    setStep({ kind: "analyzing", attempts });
    try {
      const r = await extractBusinessSpec({
        provider: createProvider(),
        model,
        description,
        signal: ctrl.signal,
        onAttempt: (a) => {
          attempts.push(a);
          setStep({ kind: "analyzing", attempts: [...attempts] });
        },
      });
      if (!r.ok) {
        setError(`The AI could not produce valid assumptions after ${r.attempts.length} attempts: ${r.errors.join(" ")} Try rephrasing, or build from a template.`);
        setStep({ kind: "describe" });
        return;
      }
      const found = new Map(r.value.assumptions.map((a) => [a.key, a]));
      setRows(
        ASSUMPTIONS.map((def): Row => {
          const a = found.get(def.key);
          return a ? { key: def.key, value: a.value, include: true, source: a.source, confidence: a.confidence, evidence: a.evidence } : { key: def.key, include: false, source: "missing" };
        }).sort((x, y) => Number(y.source !== "missing") - Number(x.source !== "missing")),
      );
      setName(r.value.name);
      setStep({ kind: "review", spec: r.value });
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "describe" });
    }
  };

  const included = rows.filter((r) => r.include && r.value !== undefined);
  const missing = missingEssentials(Object.fromEntries(included.map((r) => [r.key, r.value!])));

  const build = () => {
    const spec = step.kind === "review" ? step.spec : null;
    const m = buildModelFromAssumptions({
      name: name.trim() || spec?.name || "AI model",
      summary: spec?.summary,
      businessType: spec?.businessType,
      assumptions: included.map((r) => ({
        key: r.key,
        value: r.value!,
        source: r.source === "ai" ? "ai" : "user",
        confidence: r.source === "ai" ? r.confidence ?? "low" : "high",
        evidence: r.evidence,
      })),
    });
    const v = validateForSimulation(m);
    const errors = v.issues.filter((i) => i.severity === "error").map((i) => i.message);
    if (errors.length) {
      // Never create a broken model: show the problems instead.
      setBuildErrors(errors);
      return;
    }
    onCreated(m);
    reset();
  };

  const reset = () => {
    setStep({ kind: "describe" });
    setRows([]);
    setBuildErrors([]);
    setError(null);
  };

  const setRow = (key: AssumptionKey, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onClose={() => { abort.current?.abort(); onClose(); }} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <AutoAwesomeIcon color="secondary" /> Describe your business
        <Box sx={{ flex: 1 }} />
        {model && <Chip size="small" label={`Local AI · ${model}`} variant="outlined" />}
        <SettingsLink />
      </DialogTitle>
      <DialogContent dividers>
        {loading ? <LinearProgress /> : <AIStatusNotice status={status} onRetry={refresh} />}
        {step.kind === "describe" && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography color="text.secondary">Tell us how your business works in plain words. The AI extracts the numbers; you review them before anything is built.</Typography>
            <TextField
              multiline
              minRows={5}
              autoFocus
              placeholder={EXAMPLE}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 4000, "aria-label": "Business description" } }}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setDescription(EXAMPLE)}>
                Use example
              </Button>
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
        {step.kind === "analyzing" && (
          <Stack spacing={2} sx={{ py: 3 }} aria-live="polite">
            <Typography>Reading your description…</Typography>
            <LinearProgress color="secondary" />
            {step.attempts.filter((a) => a.errors.length).map((a) => (
              <Typography key={a.attempt} variant="body2" color="text.secondary">
                Attempt {a.attempt} had {a.errors.length} problem{a.errors.length === 1 ? "" : "s"} — asking the AI to fix: {a.errors[0]}
              </Typography>
            ))}
          </Stack>
        )}
        {step.kind === "review" && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>
              I can build this. {step.spec.summary} Review the numbers below — values from your description are marked, AI suggestions need your approval, and nothing missing is invented.
            </Typography>
            {step.spec.questions.length > 0 && (
              <Alert severity="info">
                <Typography sx={{ fontWeight: 600 }}>The AI needs a few answers (fill them in below if you know them):</Typography>
                {step.spec.questions.map((q) => (
                  <Typography key={q} variant="body2">
                    • {q}
                  </Typography>
                ))}
              </Alert>
            )}
            <TextField size="small" label="Model name" value={name} onChange={(e) => setName(e.target.value)} />
            <Table size="small">
              <TableBody>
                {rows.map((r) => {
                  const def = ASSUMPTIONS.find((a) => a.key === r.key)!;
                  const pres = unitPresentation(def.unit);
                  return (
                    <TableRow key={r.key} sx={{ opacity: r.include ? 1 : 0.7 }}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={r.include} disabled={r.value === undefined} onChange={(e) => setRow(r.key, { include: e.target.checked })} slotProps={{ input: { "aria-label": `Include ${def.label}` } }} />
                      </TableCell>
                      <TableCell>
                        <Tooltip title={def.help}>
                          <span>{def.label}</span>
                        </Tooltip>
                        {r.evidence && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                            {r.source === "user" ? `“${r.evidence}”` : r.evidence}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ width: 190 }}>
                        <NumberInput
                          value={r.value}
                          scale={pres.scale}
                          prefix={pres.prefix}
                          suffix={pres.suffix}
                          placeholder="not provided"
                          onCommit={(v) => setRow(r.key, v === undefined ? { value: undefined, include: false } : { value: v, include: true, source: r.source === "ai" && v === r.value ? "ai" : "user" })}
                          slotProps={{ htmlInput: { "aria-label": def.label } }}
                        />
                      </TableCell>
                      <TableCell sx={{ width: 170 }}>
                        {r.source === "user" && <Chip size="small" color="success" variant="outlined" label="From your description" />}
                        {r.source === "ai" && <Chip size="small" color="secondary" variant="outlined" label={`AI suggested · ${r.confidence ?? "low"}`} />}
                        {r.source === "missing" && r.value === undefined && <Chip size="small" variant="outlined" label="Not provided" color={missing.includes(r.key) ? "error" : "default"} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {missing.length > 0 && (
              <Alert severity="warning">
                Still needed to build a model: {missing.map((k) => ASSUMPTIONS.find((a) => a.key === k)!.label).join(", ")}.
              </Alert>
            )}
            {buildErrors.length > 0 && (
              <Alert severity="error">
                The model was not created because it would be invalid:
                {buildErrors.map((e) => (
                  <div key={e}>• {e}</div>
                ))}
              </Alert>
            )}
            <PreviewReview included={included} name={name} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {step.kind === "review" && <Button onClick={reset}>Start over</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => { abort.current?.abort(); onClose(); }}>Cancel</Button>
        {step.kind === "describe" && (
          <Button variant="contained" color="secondary" disabled={!aiReady || description.trim().length < 10} onClick={analyze}>
            Analyze description
          </Button>
        )}
        {step.kind === "analyzing" && <Button onClick={() => abort.current?.abort()}>Stop</Button>}
        {step.kind === "review" && (
          <Button variant="contained" color="secondary" disabled={missing.length > 0} onClick={build}>
            Yes, build it
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Shows the deterministic model review for what would be built. */
function PreviewReview({ included, name }: { included: Row[]; name: string }) {
  if (missingEssentials(Object.fromEntries(included.map((r) => [r.key, r.value!]))).length) return null;
  const m = buildModelFromAssumptions({ name: name || "preview", assumptions: included.map((r) => ({ key: r.key, value: r.value!, source: r.source === "ai" ? "ai" : "user", confidence: r.confidence ?? "high" })) });
  const review = reviewModel(m);
  return (
    <Box sx={{ p: 1.5, bgcolor: "background.default", borderRadius: 1, border: 1, borderColor: "divider" }}>
      <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Model review · simulation confidence: {review.confidence}</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        {review.items.map((i) => (
          <Typography key={i.label} variant="body2" color={i.ok ? "success.main" : "warning.main"}>
            {i.ok ? "✓" : "⚠"} {i.label}
          </Typography>
        ))}
      </Box>
      {review.pendingAssumptions > 0 && (
        <Typography variant="caption" color="text.secondary">
          {review.pendingAssumptions} AI-suggested assumption{review.pendingAssumptions === 1 ? "" : "s"} will be marked for your review.
        </Typography>
      )}
    </Box>
  );
}
