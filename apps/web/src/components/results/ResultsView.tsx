"use client";

import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import dynamic from "next/dynamic";
import { useEditor, type ResultsTab } from "@/store/editor-store";
import { Dashboard } from "./Dashboard";

const loading = () => <Skeleton variant="rounded" height={400} />;
// Each analysis view (and its chart code) loads only when opened.
const ScenariosPanel = dynamic(() => import("./ScenariosPanel"), { ssr: false, loading });
const RiskPanel = dynamic(() => import("./RiskPanel"), { ssr: false, loading });
const SensitivityPanel = dynamic(() => import("./SensitivityPanel"), { ssr: false, loading });
const GuardrailsPanel = dynamic(() => import("./GuardrailsPanel"), { ssr: false, loading });

export function ResultsView() {
  const tab = useEditor((s) => s.resultsTab);
  const setTab = useEditor((s) => s.setResultsTab);
  const mcRunning = useEditor((s) => s.monteCarlo.status === "running");
  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", px: { xs: 1, md: 3 }, position: "sticky", top: 0, zIndex: 2 }}>
        <Tabs value={tab} onChange={(_, v: ResultsTab) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          <Tab value="overview" label="Overview" />
          <Tab value="scenarios" label="Scenarios" />
          <Tab value="risk" label={mcRunning ? "Risk & uncertainty (running…)" : "Risk & uncertainty"} />
          <Tab value="sensitivity" label="What matters most" />
          <Tab value="guardrails" label="Guardrails" />
        </Tabs>
      </Box>
      {tab === "overview" ? (
        <Dashboard />
      ) : (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
          {tab === "scenarios" && <ScenariosPanel />}
          {tab === "risk" && <RiskPanel />}
          {tab === "sensitivity" && <SensitivityPanel />}
          {tab === "guardrails" && <GuardrailsPanel />}
        </Box>
      )}
    </Box>
  );
}
