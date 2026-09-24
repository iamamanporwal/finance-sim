"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import dynamic from "next/dynamic";
import type { Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { KpiCards } from "./KpiCards";
import { PeriodDetail } from "./PeriodDetail";
import { Timeline } from "./Timeline";
import { WhatChanged } from "./WhatChanged";

// Charts are the heaviest dependency — load them only when results are shown.
const Charts = dynamic(() => import("./Charts"), {
  ssr: false,
  loading: () => <Skeleton variant="rounded" height={520} />,
});

export function Dashboard() {
  const model = useEditor((s) => s.model)!;
  const result = useEditor((s) => s.result);
  const status = useEditor((s) => s.simStatus);
  const stale = useEditor((s) => s.stale);
  const validation = useEditor((s) => s.validation);
  const simError = useEditor((s) => s.simError);
  const change = useEditor((s) => s.change);
  const selected = useEditor((s) => s.selectedPeriod);
  const setSelected = useEditor((s) => s.setSelectedPeriod);
  const setMode = useEditor((s) => s.setMode);
  const currency = model.settings.currency as Currency;
  const errors = validation?.issues.filter((i) => i.severity === "error") ?? [];

  const problem =
    status === "blocked" ? (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setMode("simulate")}>Review issues</Button>}>
        Simulation blocked — {errors.length} issue{errors.length === 1 ? "" : "s"} found. {result ? "Showing the last successful run." : ""}
      </Alert>
    ) : status === "error" ? (
      <Alert severity="error">{simError?.message ?? "Simulation failed."} {result ? "Showing the last successful run." : ""}</Alert>
    ) : null;

  if (!result) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
        {problem}
        <Typography variant="h3" sx={{ mt: 2 }}>
          No results yet
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {model.nodes.length === 0 ? "Build a model on the canvas, then run the simulation." : "Fix the issues above, then run the simulation."}
        </Typography>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => setMode("build")}>
          Go to canvas
        </Button>
      </Box>
    );
  }

  const period = selected ?? result.timeline.length;
  const changedParam = change ? model.parameters.find((p) => p.id === change.parameterId) : undefined;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto", opacity: stale && status !== "ok" ? 0.6 : 1 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2, flexWrap: "wrap" }}>
        <Typography variant="h2">Simulation results</Typography>
        <Chip size="small" label="Forecast" variant="outlined" />
        <Typography variant="body2" color="text.secondary">
          {result.timeline.length} {result.settings.timeStep} periods · {result.timeline[0]!.period} → {result.timeline[result.timeline.length - 1]!.period} · seed {result.seed}
        </Typography>
      </Stack>
      <Stack spacing={2}>
        {problem}
        {change && changedParam && <WhatChanged change={change} result={result} currentValue={changedParam.value} currency={currency} />}
        <KpiCards result={result} baseline={change?.baseline} currency={currency} />
        <Charts result={result} currency={currency} selectedPeriod={selected} onSelectPeriod={setSelected} />
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Timeline
          </Typography>
          <Timeline result={result} selected={period} onSelect={setSelected} />
        </Box>
        <PeriodDetail model={model} result={result} period={period} currency={currency} />
      </Stack>
    </Box>
  );
}
