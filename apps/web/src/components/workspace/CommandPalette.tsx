"use client";

import Dialog from "@mui/material/Dialog";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { applyAutoLayout } from "@fin/model-schema";
import { searchPresets } from "@/lib/presets";
import { useCopilot } from "@/store/copilot-store";
import { useEditor } from "@/store/editor-store";
import { useAddAtCenter } from "./NodeLibrary";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

export function CommandPalette() {
  const open = useEditor((s) => s.paletteOpen);
  const setOpen = useEditor((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const addAtCenter = useAddAtCenter();

  const commands = useMemo<Command[]>(() => {
    const s = useEditor.getState;
    const base: Command[] = [
      { id: "run", label: "Run simulation", hint: "⌘↵", run: () => { s().run(); s().setMode(s().simStatus === "ok" ? "results" : "simulate"); } },
      { id: "ai", label: "Ask AI", hint: "copilot", run: () => useCopilot.getState().setOpen(true) },
      { id: "results", label: "Show results dashboard", run: () => s().setMode("results") },
      { id: "mc", label: "Run Monte Carlo", run: () => s().setResultsTab("risk") },
      { id: "scenario", label: "Create scenario", run: () => s().setResultsTab("scenarios") },
      { id: "sensitivity", label: "What matters most?", run: () => s().setResultsTab("sensitivity") },
      { id: "report", label: "Open report", run: () => s().setMode("report") },
      { id: "why-mrr", label: "Why is MRR this value?", hint: "Why?", run: () => { s().setMode("results"); s().openWhy({ metric: "mrr" }); } },
      { id: "why-cash", label: "Why is cash this value?", hint: "Why?", run: () => { s().setMode("results"); s().openWhy({ metric: "cash" }); } },
      { id: "business", label: "Business stage & goals", run: () => s().openBusiness("profile") },
      { id: "current", label: "Enter current state (today's numbers)", run: () => s().openBusiness("current") },
      { id: "actuals", label: "Enter or paste actuals", run: () => s().openBusiness("actuals") },
      { id: "metrics", label: "Custom metrics", run: () => s().openBusiness("metrics") },
      { id: "revenue", label: "Show revenue", run: () => s().setMode("results") },
      { id: "cash", label: "Show cash", run: () => s().setMode("results") },
      { id: "build", label: "Go to canvas (Build)", run: () => s().setMode("build") },
      { id: "layout", label: "Tidy up layout", hint: "auto-arrange", run: () => { s().setMode("build"); s().apply((m) => applyAutoLayout(m), { structural: false }); } },
      { id: "settings", label: "Simulation settings", run: () => s().setMode("simulate") },
      { id: "undo", label: "Undo", hint: "⌘Z", run: () => s().undo() },
      { id: "redo", label: "Redo", hint: "⌘⇧Z", run: () => s().redo() },
      { id: "save", label: "Save version", hint: "⌘S", run: () => s().save({ version: "manual" }) },
      { id: "versions", label: "Version history", run: () => s().setPanel("versions") },
      { id: "export", label: "Export (JSON, CSV, PDF)", run: () => s().setPanel("export") },
    ];
    const q = query.trim().toLowerCase();
    const matching = base.filter((c) => !q || c.label.toLowerCase().includes(q));
    const nodes: Command[] = searchPresets(query).map((p) => ({
      id: `add-${p.id}`,
      label: `Add node: ${p.label}`,
      hint: p.group,
      run: () => {
        s().setMode("build");
        addAtCenter(p.id);
      },
    }));
    const params: Command[] = q
      ? (s().model?.nodes ?? [])
          .filter((n) => n.label.toLowerCase().includes(q))
          .map((n) => ({ id: `find-${n.id}`, label: `Find: ${n.label}`, run: () => { s().setMode("build"); s().select([n.id]); } }))
      : [];
    return [...matching, ...params, ...nodes].slice(0, 30);
  }, [query, addAtCenter]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const execute = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { position: "fixed", top: 80, m: 0 } } }}>
      <TextField
        autoFocus
        fullWidth
        placeholder="Type a command or search nodes…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, commands.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            execute(commands[active]);
          }
        }}
        sx={{ "& fieldset": { border: "none" }, borderBottom: 1, borderColor: "divider" }}
      />
      <List dense sx={{ maxHeight: 400, overflowY: "auto" }}>
        {commands.map((c, i) => (
          <ListItemButton key={c.id} selected={i === active} onClick={() => execute(c)} onMouseEnter={() => setActive(i)}>
            <ListItemText primary={c.label} />
            {c.hint && (
              <Typography variant="caption" color="text.secondary">
                {c.hint}
              </Typography>
            )}
          </ListItemButton>
        ))}
        {commands.length === 0 && (
          <Typography color="text.secondary" sx={{ px: 2, py: 1 }}>
            Nothing matches.
          </Typography>
        )}
      </List>
    </Dialog>
  );
}
