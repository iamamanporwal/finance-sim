"use client";

import { CURRENCIES, TIME_STEPS, type ValidationIssue } from "@fin/model-schema";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { updateSettings } from "@/lib/model-ops";
import { useEditor } from "@/store/editor-store";
import { NumberInput } from "./NumberInput";

const CHECKS: { label: string; codes: string[] }[] = [
  { label: "All nodes connected", codes: ["disconnected-node", "not-in-cash", "no-cash", "dangling-connection", "self-connection", "invalid-port", "multiple-inputs", "duplicate-connection"] },
  { label: "No circular dependency", codes: ["circular-dependency"] },
  { label: "All required inputs defined", codes: ["missing-input", "missing-parameter", "unknown-slot", "slot-not-parameter", "input-overridden", "missing-tiers"] },
  { label: "Units and currency consistent", codes: ["unit-mismatch", "unknown-unit"] },
  { label: "Percentages and ranges valid", codes: ["out-of-range", "invalid-range", "invalid-distribution", "invalid-period", "invalid-tiers"] },
  { label: "Shares total 100%", codes: ["split-total", "duplicate-branch"] },
  { label: "Formulas valid", codes: ["invalid-formula"] },
];

export function SimulatePanel() {
  const model = useEditor((s) => s.model)!;
  const validation = useEditor((s) => s.validation);
  const apply = useEditor((s) => s.apply);
  const setMode = useEditor((s) => s.setMode);
  const simError = useEditor((s) => s.simError);
  const select = useEditor((s) => s.select);
  const s = model.settings;
  const issues = validation?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  const known = new Set(CHECKS.flatMap((c) => c.codes));
  const other = issues.filter((i) => !known.has(i.code));

  const run = () => {
    const st = useEditor.getState();
    st.run();
    if (useEditor.getState().simStatus === "ok") setMode("results");
  };

  const set = (patch: Parameters<typeof updateSettings>[1]) => apply((m) => updateSettings(m, patch));

  const showIssue = (i: ValidationIssue) => {
    if (i.nodeId) {
      select([i.nodeId]);
      setMode("build");
    }
  };

  return (
    <Box sx={{ height: "100%", overflowY: "auto", py: 4, px: 2 }}>
      <Stack spacing={3} sx={{ maxWidth: 720, mx: "auto" }}>
        <Paper sx={{ p: 3, border: 1, borderColor: "divider" }}>
          <Typography variant="h3" gutterBottom>
            Simulation settings
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
            <TextField
              label="Start"
              type="month"
              size="small"
              value={s.startDate.slice(0, 7)}
              onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && set({ startDate: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField select label="Time step" size="small" value={s.timeStep} onChange={(e) => set({ timeStep: e.target.value as typeof s.timeStep })} sx={{ minWidth: 140 }}>
              {TIME_STEPS.map((t) => (
                <MenuItem key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </MenuItem>
              ))}
            </TextField>
            <NumberInput label="Horizon (periods)" value={s.horizon} onCommit={(v) => v !== undefined && set({ horizon: Math.min(1000, Math.max(1, Math.round(v))) })} />
            <NumberInput label="Seed" value={s.seed} onCommit={(v) => v !== undefined && set({ seed: Math.max(0, Math.round(v)) })} helperText="Same seed → same result" />
            <TextField select label="Currency" size="small" sx={{ minWidth: 100 }} value={s.currency} onChange={(e) => set({ currency: e.target.value as typeof s.currency })}>
              {CURRENCIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            Rates (growth, churn, conversion) apply per time step. Monte Carlo runs arrive in a later release.
          </Typography>
        </Paper>

        <Paper sx={{ p: 3, border: 1, borderColor: "divider" }}>
          <Typography variant="h3" gutterBottom>
            Validation
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 1.5 }}>
            {CHECKS.map((c) => {
              const found = issues.filter((i) => c.codes.includes(i.code));
              const hasError = found.some((i) => i.severity === "error");
              const Icon = hasError ? CancelOutlinedIcon : found.length ? WarningAmberIcon : CheckCircleOutlineIcon;
              const color = hasError ? "error.main" : found.length ? "warning.main" : "success.main";
              return (
                <Box key={c.label}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", color }}>
                    <Icon sx={{ fontSize: 18 }} />
                    <Typography sx={{ color: "text.primary" }}>{c.label}</Typography>
                  </Stack>
                  {found.map((i, k) => (
                    <Typography key={k} variant="body2" color="text.secondary" onClick={() => showIssue(i)} sx={{ pl: 3.5, cursor: i.nodeId ? "pointer" : "default", "&:hover": i.nodeId ? { textDecoration: "underline" } : {} }}>
                      {i.message}
                    </Typography>
                  ))}
                </Box>
              );
            })}
            {other.map((i, k) => (
              <Typography key={k} variant="body2" color={i.severity === "error" ? "error" : "warning.main"}>
                {i.message}
              </Typography>
            ))}
          </Stack>
          {simError && (
            <Typography color="error" sx={{ mt: 2 }}>
              The last run failed: {simError.message}
            </Typography>
          )}
          <Stack direction="row" spacing={2} sx={{ mt: 3, alignItems: "center" }}>
            <Button variant="contained" color="secondary" size="large" startIcon={<PlayArrowIcon />} disabled={errors.length > 0 || model.nodes.length === 0} onClick={run}>
              Run simulation
            </Button>
            {errors.length > 0 && (
              <Typography color="error">
                Simulation blocked — {errors.length} issue{errors.length === 1 ? "" : "s"} found
              </Typography>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}
