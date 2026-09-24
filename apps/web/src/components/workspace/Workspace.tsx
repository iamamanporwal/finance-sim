"use client";

import type { Model } from "@fin/model-schema";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { pendingAssumptions } from "@/lib/assumption-review";
import Snackbar from "@mui/material/Snackbar";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";
import { ResultsView } from "@/components/results/ResultsView";
import { ReportView } from "@/components/report/ReportView";
import { useEditor, type Mode } from "@/store/editor-store";
import { Canvas } from "./Canvas";
import { CopilotPanel } from "@/components/ai/CopilotPanel";
import { CommandPalette } from "./CommandPalette";
import { NodeLibrary } from "./NodeLibrary";
import { PropertiesPanel } from "./PropertiesPanel";
import { QuickMetrics } from "./QuickMetrics";
import { SimulatePanel } from "./SimulatePanel";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./useShortcuts";

export default function Workspace({ model, initialMode }: { model: Model; initialMode: Mode }) {
  const load = useEditor((s) => s.load);
  const loaded = useEditor((s) => s.model?.id === model.id);
  const mode = useEditor((s) => s.mode);
  const notice = useEditor((s) => s.notice);
  const clearNotice = useEditor((s) => s.clearNotice);

  useEffect(() => {
    load(model);
    useEditor.getState().setMode(initialMode);
  }, [model, initialMode, load]);

  // Flush unsaved changes when leaving the page.
  useEffect(() => {
    const flush = () => {
      if (useEditor.getState().saveState.dirty) useEditor.getState().save();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  useShortcuts();
  if (!loaded) return null;

  return (
    <ReactFlowProvider>
      <Box className="print-root" sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
        <Box className="no-print">
          <TopBar />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: mode === "build" ? "grid" : "none", gridTemplateColumns: "260px 1fr 340px" }}>
          <Box component="aside" aria-label="Node library" sx={{ borderRight: 1, borderColor: "divider", bgcolor: "background.paper", minHeight: 0 }}>
            <NodeLibrary />
          </Box>
          <Box component="main" sx={{ minWidth: 0, minHeight: 0, position: "relative" }}>
            <Canvas />
            <ReviewBanner />
          </Box>
          <Box component="aside" aria-label="Properties" sx={{ borderLeft: 1, borderColor: "divider", bgcolor: "background.paper", overflowY: "auto", minHeight: 0 }}>
            <PropertiesPanel />
          </Box>
        </Box>
        {mode === "build" && <QuickMetrics />}
        {mode === "simulate" && (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <SimulatePanel />
          </Box>
        )}
        {mode === "results" && (
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <ResultsView />
          </Box>
        )}
        {mode === "report" && (
          <Box className="print-root" sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <ReportView />
          </Box>
        )}
      </Box>
      <CommandPalette />
      <CopilotPanel />
      <Snackbar open={!!notice} autoHideDuration={3500} onClose={clearNotice} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {notice ? (
          <Alert severity={notice.severity} onClose={clearNotice} variant="filled" sx={{ width: "100%" }}>
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ReactFlowProvider>
  );
}

/** Reminds the user that AI suggestions are waiting for review. */
function ReviewBanner() {
  const model = useEditor((s) => s.model);
  const select = useEditor((s) => s.select);
  if (!model) return null;
  const pending = pendingAssumptions(model).length;
  if (pending === 0) return null;
  return (
    <Alert
      severity="info"
      icon={false}
      sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5, boxShadow: 2, py: 0 }}
      action={
        <Button size="small" color="inherit" onClick={() => select([], [])}>
          Review
        </Button>
      }
    >
      {pending} AI-suggested assumption{pending === 1 ? "" : "s"} need{pending === 1 ? "s" : ""} your review.
    </Alert>
  );
}
