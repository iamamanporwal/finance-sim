"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import SendIcon from "@mui/icons-material/Send";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { effectiveModel, useAIStatus } from "@/lib/ai-client";
import { useCopilot, type CopilotItem } from "@/store/copilot-store";
import { tokens } from "@/theme/theme";
import { AIStatusNotice, SettingsLink } from "./AIStatusNotice";
import { SafeMarkdown } from "./SafeMarkdown";

const SUGGESTIONS = [
  "Why is MRR what it is at the end of the forecast?",
  "Increase pricing by 20%.",
  "What happens if churn doubles?",
  "Run a downside scenario.",
  "What happens if AI costs increase 50%?",
  "Compare hiring 2 engineers ($8K/month each) vs raising prices 10%.",
  "Run 10,000 simulations.",
];

const TOOL_LABELS: Record<string, string> = {
  get_model: "Read the model",
  get_node: "Read a node",
  get_connections: "Read connections",
  create_node: "Added a node",
  update_node: "Updated a node",
  delete_node: "Deleted a node",
  connect_nodes: "Connected nodes",
  disconnect_nodes: "Removed a connection",
  update_assumption: "Changed an assumption",
  create_scenario: "Created a scenario",
  compare_scenarios: "Compared scenarios",
  what_if: "Ran a what-if scenario",
  compare_options: "Compared options",
  create_standard_scenarios: "Created upside/downside scenarios",
  validate_model: "Validated the model",
  run_simulation: "Ran the simulation",
  run_monte_carlo: "Ran Monte Carlo",
  get_metric: "Read a metric",
  get_timeline: "Read the timeline",
  run_sensitivity_analysis: "Ran sensitivity analysis",
  explain_metric: "Traced a metric",
  find_bottleneck: "Looked for bottlenecks",
};

export function CopilotPanel() {
  const open = useCopilot((s) => s.open);
  const items = useCopilot((s) => s.items);
  const running = useCopilot((s) => s.running);
  const { send, stop, clear, setOpen } = useCopilot.getState();
  const { status, refresh } = useAIStatus();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const model = effectiveModel(status);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items, running]);

  if (!open) return null;
  const submit = (t: string) => {
    if (!t.trim() || running) return;
    setText("");
    void send(t.trim());
  };

  return (
    <Paper
      className="no-print"
      role="complementary"
      aria-label="AI copilot"
      sx={{ position: "fixed", top: 56, right: 0, bottom: 0, width: { xs: "100%", sm: 420 }, zIndex: 1200, display: "flex", flexDirection: "column", borderLeft: 1, borderColor: "divider", boxShadow: "-8px 0 24px rgba(15,23,42,0.08)" }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
        <AutoAwesomeIcon sx={{ color: tokens.simulation }} fontSize="small" />
        <Typography sx={{ fontWeight: 600, flex: 1 }}>AI copilot</Typography>
        {model && <Chip size="small" variant="outlined" label={model} />}
        <SettingsLink />
        <Tooltip title="Clear conversation">
          <IconButton size="small" onClick={clear} aria-label="Clear conversation">
            <DeleteSweepOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close copilot">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box ref={scroller} sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        <AIStatusNotice status={status} onRetry={refresh} />
        {items.length === 0 && (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Ask about your model or tell me what to change. I work through the same validated tools as the editor, every change can be undone (⌘Z), and every number I quote comes from the simulation engine.
            </Typography>
            <Stack spacing={0.75}>
              {SUGGESTIONS.map((s) => (
                <Chip key={s} label={s} variant="outlined" onClick={() => submit(s)} sx={{ justifyContent: "flex-start", height: "auto", py: 0.5, "& .MuiChip-label": { whiteSpace: "normal" } }} />
              ))}
            </Stack>
          </Stack>
        )}
        <Stack spacing={1.25}>
          {items.map((it, i) => (
            <Item key={i} item={it} />
          ))}
          {running && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
              <CircularProgress size={14} color="secondary" />
              <Typography variant="body2">Working…</Typography>
            </Stack>
          )}
        </Stack>
      </Box>

      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
          <TextField
            fullWidth
            multiline
            maxRows={5}
            size="small"
            placeholder={status?.reachable ? "Ask or instruct… (Enter to send)" : "Local AI is not available"}
            value={text}
            disabled={!status?.reachable}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(text);
              }
            }}
            slotProps={{ htmlInput: { "aria-label": "Message the copilot", maxLength: 4000 } }}
          />
          {running ? (
            <Button variant="outlined" color="error" onClick={stop}>
              Stop
            </Button>
          ) : (
            <IconButton color="secondary" disabled={!text.trim() || !status?.reachable} onClick={() => submit(text)} aria-label="Send">
              <SendIcon />
            </IconButton>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}

function Item({ item }: { item: CopilotItem }) {
  const [expanded, setExpanded] = useState(false);
  switch (item.kind) {
    case "user":
      return (
        <Box sx={{ alignSelf: "flex-end", maxWidth: "85%", bgcolor: `${tokens.primary}14`, px: 1.5, py: 1, borderRadius: 2 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {item.text}
          </Typography>
        </Box>
      );
    case "assistant":
      return <SafeMarkdown text={item.text} />;
    case "error":
      return (
        <Typography variant="body2" color="error">
          {item.text}
        </Typography>
      );
    case "tool": {
      const error = item.ok === false ? (item.result as { error?: string } | undefined)?.error : undefined;
      return (
        <Box sx={{ border: 1, borderColor: item.ok === false ? "error.light" : "divider", borderRadius: 1.5, px: 1, py: 0.5 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
            {item.ok === undefined ? <CircularProgress size={12} /> : <BuildOutlinedIcon sx={{ fontSize: 14, color: item.ok ? tokens.positive : tokens.risk }} />}
            <Typography variant="caption" sx={{ fontWeight: 500, flex: 1 }}>
              {TOOL_LABELS[item.name] ?? item.name}
              <span style={{ color: tokens.textSecondary, fontFamily: "ui-monospace, Menlo, monospace" }}> · {item.name}</span>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {expanded ? "hide" : "details"}
            </Typography>
          </Stack>
          {error && (
            <Typography variant="caption" color="error" sx={{ display: "block" }}>
              {error}
            </Typography>
          )}
          <Collapse in={expanded}>
            <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 240, overflow: "auto", color: "text.secondary" }}>
              {JSON.stringify({ arguments: item.args, result: item.result }, null, 1)}
            </Box>
          </Collapse>
        </Box>
      );
    }
  }
}
