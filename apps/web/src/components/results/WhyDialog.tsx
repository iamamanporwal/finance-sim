"use client";

import { explainWhy, type WhyExplanation, type WhyStep } from "@fin/simulation-engine";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VerifiedIcon from "@mui/icons-material/Verified";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMemo, useRef, useState } from "react";
import { explainWithAI } from "@/ai/why";
import { createProvider, effectiveModel, useAIStatus } from "@/lib/ai-client";
import { formatKind, type Currency, type ValueKind } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

const SOURCE: Record<string, { label: string; color: "default" | "secondary" | "info" | "warning" }> = {
  user: { label: "You", color: "default" },
  ai: { label: "AI suggested", color: "secondary" },
  template: { label: "Template", color: "info" },
  benchmark: { label: "Benchmark", color: "info" },
  imported: { label: "Imported", color: "warning" },
};

/** "Why?" — the causal chain behind a number, every value straight from the engine. */
export default function WhyDialog() {
  const why = useEditor((s) => s.why);
  const close = useEditor((s) => s.closeWhy);
  const model = useEditor((s) => s.model);
  const result = useEditor((s) => s.result);
  const currency = (model?.settings.currency ?? "USD") as Currency;
  const format = (v: number | null, kind: ValueKind) => formatKind(v, kind, currency);

  const explanation = useMemo<WhyExplanation | { error: string } | null>(() => {
    if (!why || !model || !result) return null;
    try {
      return explainWhy(model, result, "metric" in why ? { metric: why.metric } : { nodeId: why.nodeId, port: why.port }, {
        period: why.period,
        format: (v, k) => formatKind(v, k, currency),
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [why, model, result, currency]);

  if (!why) return null;
  const e = explanation && !("error" in explanation) ? explanation : null;

  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth aria-labelledby="why-title">
      <DialogTitle id="why-title" sx={{ pb: 0.5 }}>
        {e ? (
          <>
            Why is {e.root.label} <span className="num">{format(e.root.value, e.root.valueKind)}</span> in {e.periodLabel}?
          </>
        ) : (
          "Why?"
        )}
      </DialogTitle>
      <DialogContent>
        {explanation && "error" in explanation && <Alert severity="error">{explanation.error}</Alert>}
        {!result && <Alert severity="info">Run the simulation first.</Alert>}
        {e && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Traced through the model with the simulation&apos;s own numbers{e.scenarioId ? ` (scenario: ${model?.scenarios.find((s) => s.id === e.scenarioId)?.name ?? e.scenarioId})` : ""}. Nothing here is estimated.
            </Typography>
            <Box aria-label="Main causal chain" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}>
              {e.chain.map((c, i) => (
                <Stack key={i} direction="row" sx={{ alignItems: "center" }}>
                  {i > 0 && <Typography sx={{ color: "text.disabled", mx: 0.25 }}>←</Typography>}
                  <Chip size="small" label={c} variant={i === 0 ? "filled" : "outlined"} color={i === 0 ? "primary" : "default"} />
                </Stack>
              ))}
            </Box>
            <Box role="tree" aria-label="Explanation" sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.5, maxHeight: 420, overflowY: "auto" }}>
              <StepView step={e.root} depth={0} format={format} />
            </Box>
            <AIExplanation explanation={e} format={format} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function StepView({ step, depth, format }: { step: WhyStep; depth: number; format: (v: number | null, k: ValueKind) => string }) {
  const [open, setOpen] = useState(depth < 3);
  const select = useEditor((s) => s.select);
  const setMode = useEditor((s) => s.setMode);
  const close = useEditor((s) => s.closeWhy);
  const hasChildren = step.children.length > 0;
  const src = step.source ? SOURCE[step.source] : undefined;
  const goTo = (nodeId: string) => {
    select([nodeId]);
    setMode("build");
    close();
  };
  return (
    <Box role="treeitem" aria-expanded={hasChildren ? open : undefined} sx={{ pl: depth ? 2 : 0, borderLeft: depth ? 1 : 0, borderColor: "divider", ml: depth ? 0.75 : 0 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start", py: 0.4 }}>
        {hasChildren ? (
          <IconButton size="small" sx={{ p: 0, mt: 0.2 }} onClick={() => setOpen(!open)} aria-label={open ? `Collapse ${step.label}` : `Expand ${step.label}`}>
            {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 20, flexShrink: 0 }} />
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: step.kind === "assumption" ? 500 : 600 }}>
              {step.nodeId && step.kind === "node" ? (
                <Link component="button" underline="hover" color="inherit" onClick={() => goTo(step.nodeId!)} sx={{ font: "inherit", verticalAlign: "baseline" }}>
                  {step.label}
                </Link>
              ) : (
                step.label
              )}
            </Typography>
            <Typography variant="body2" className="num" sx={{ fontWeight: 600, color: step.kind === "assumption" ? tokens.primary : "text.primary" }}>
              {format(step.value, step.valueKind)}
            </Typography>
            {step.kind === "assumption" && <Chip size="small" label="Assumption" variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
            {src && step.source !== "user" && <Chip size="small" label={src.label} color={src.color} variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
            {step.confidence && step.source === "ai" && <Chip size="small" label={`${step.confidence} confidence`} variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
            {step.kind === "default" && <Chip size="small" label="Default" variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
            {step.repeated && (
              <Typography variant="caption" color="text.secondary">
                (explained above)
              </Typography>
            )}
          </Stack>
          {step.formula && step.kind !== "assumption" && (
            <Typography variant="caption" color="text.secondary" className="num" sx={{ display: "block", wordBreak: "break-word" }}>
              {step.formula}
            </Typography>
          )}
        </Box>
      </Stack>
      {hasChildren && open && step.children.map((c) => <StepView key={c.key} step={c} depth={depth + 1} format={format} />)}
    </Box>
  );
}

function AIExplanation({ explanation, format }: { explanation: WhyExplanation; format: (v: number | null, k: ValueKind) => string }) {
  const { status } = useAIStatus();
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; text?: string; errors?: string[]; attempts?: number }>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);
  const model = effectiveModel(status);

  const run = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setState({ status: "running" });
    try {
      const r = await explainWithAI({ provider: createProvider(), model, explanation, format, signal: abort.current.signal });
      setState(r.ok ? { status: "done", text: r.value, attempts: r.attempts.length } : { status: "error", errors: r.errors, attempts: r.attempts.length });
    } catch (e) {
      setState({ status: "error", errors: [e instanceof Error ? e.message : String(e)] });
    }
  };

  return (
    <Box sx={{ border: 1, borderColor: `${tokens.simulation}55`, borderRadius: 1.5, p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <AutoAwesomeIcon sx={{ color: tokens.simulation, fontSize: 18 }} />
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
          Plain-English explanation
        </Typography>
        {state.status === "running" ? (
          <Button size="small" onClick={() => abort.current?.abort()} startIcon={<CircularProgress size={12} />}>
            Stop
          </Button>
        ) : (
          <Button size="small" variant="outlined" color="secondary" disabled={!status?.reachable || !model} onClick={run}>
            {state.status === "done" ? "Explain again" : "Explain with AI"}
          </Button>
        )}
      </Stack>
      {state.status === "idle" && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {explanation.sentences.slice(0, 5).map((s, i) => (
            <Typography key={i} variant="body2" color="text.secondary">
              {s}
            </Typography>
          ))}
          {!status?.reachable && (
            <Typography variant="caption" color="text.secondary">
              Local AI is not available; the explanation above is generated directly from the engine.
            </Typography>
          )}
        </Stack>
      )}
      {state.status === "done" && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {state.text}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.75, color: tokens.positive }}>
            <VerifiedIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption">Every number was checked against the engine output{state.attempts && state.attempts > 1 ? ` (corrected after ${state.attempts - 1} rejected draft${state.attempts > 2 ? "s" : ""})` : ""}.</Typography>
          </Stack>
        </Box>
      )}
      {state.status === "error" && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          The AI explanation was not shown because it did not pass the check: {state.errors?.join(" ")} Use the engine explanation above.
        </Alert>
      )}
    </Box>
  );
}
