"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useCopilot } from "@/store/copilot-store";
import { useEditor, type Mode } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

export function TopBar() {
  const model = useEditor((s) => s.model)!;
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const saveState = useEditor((s) => s.saveState);

  const runAndShow = () => {
    const s = useEditor.getState();
    s.run();
    const after = useEditor.getState();
    if (after.simStatus === "ok") setMode("results");
    else setMode("simulate");
  };

  return (
    <Box sx={{ height: 56, px: 2, display: "flex", alignItems: "center", gap: 2, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      <Typography component={Link} href="/app" sx={{ fontWeight: 700, color: tokens.primary, textDecoration: "none", fontSize: 15, whiteSpace: "nowrap" }}>
        ◆ FinSim
      </Typography>
      <Box sx={{ minWidth: 0, maxWidth: 260 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }}>
          {model.name}
        </Typography>
        <Typography noWrap variant="caption" color={saveState.error ? "error" : "text.secondary"}>
          {saveState.error ?? (saveState.dirty ? "Unsaved changes" : saveState.savedAt ? "Saved in this browser" : "Not saved yet")}
        </Typography>
      </Box>
      <Tabs value={mode} onChange={(_, v: Mode) => setMode(v)} sx={{ minHeight: 56, "& .MuiTab-root": { minHeight: 56, px: 2 } }}>
        <Tab value="build" label="Build" />
        <Tab value="simulate" label="Simulate" />
        <Tab value="results" label="Results" />
        <Tab value="report" label="Report" />
      </Tabs>
      <Box sx={{ flex: 1 }} />
      <ScenarioSelect />
      <Stack direction="row" spacing={0.5}>
        <Tooltip title="Undo (⌘Z)">
          <span>
            <IconButton size="small" disabled={!canUndo} onClick={undo} aria-label="Undo">
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Redo (⌘⇧Z)">
          <span>
            <IconButton size="small" disabled={!canRedo} onClick={redo} aria-label="Redo">
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Tooltip title="Chat with the AI copilot" describeChild>
        <Button variant="outlined" color="secondary" startIcon={<AutoAwesomeIcon />} onClick={() => useCopilot.getState().setOpen(!useCopilot.getState().open)}>
          Ask AI
        </Button>
      </Tooltip>
      <Tooltip title="Run simulation (⌘↵)" describeChild>
        <Button variant="contained" color="secondary" startIcon={<PlayArrowIcon />} onClick={runAndShow}>
          Run simulation
        </Button>
      </Tooltip>
    </Box>
  );
}

function ScenarioSelect() {
  const scenarios = useEditor((s) => s.model?.scenarios ?? []);
  const active = useEditor((s) => s.activeScenarioId);
  const setActive = useEditor((s) => s.setActiveScenario);
  const setResultsTab = useEditor((s) => s.setResultsTab);
  return (
    <TextField
      select
      size="small"
      label="Scenario"
      value={active ?? "__base"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__manage") setResultsTab("scenarios");
        else setActive(v === "__base" ? null : v);
      }}
      sx={{ minWidth: 180, "& .MuiOutlinedInput-root": active ? { bgcolor: `${tokens.simulation}10` } : {} }}
      helperText={active ? "Edits are saved as overrides" : undefined}
      slotProps={{ formHelperText: { sx: { position: "absolute", bottom: -18, m: 0, whiteSpace: "nowrap", color: tokens.simulation } } }}
    >
      <MenuItem value="__base">Base model</MenuItem>
      {scenarios.map((s) => (
        <MenuItem key={s.id} value={s.id}>
          {s.name}
          {s.overrides.length ? ` · ${s.overrides.length} change${s.overrides.length === 1 ? "" : "s"}` : ""}
        </MenuItem>
      ))}
      <MenuItem value="__manage" sx={{ color: "primary.main" }}>
        Manage scenarios…
      </MenuItem>
    </TextField>
  );
}
