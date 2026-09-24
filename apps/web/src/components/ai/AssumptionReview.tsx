"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { reviewModel } from "@/ai/review";
import { acceptAll, acceptAssumption, describeRejection, pendingAssumptions, rejectAssumption } from "@/lib/assumption-review";
import { formatByUnit, type Currency } from "@/lib/format";
import { useEditor } from "@/store/editor-store";
import { tokens } from "@/theme/theme";

/** Accept / Edit / Reject for every AI-suggested assumption, plus the model review checklist. */
export function AssumptionReview() {
  const model = useEditor((s) => s.model)!;
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const setMode = useEditor((s) => s.setMode);
  const notify = useEditor((s) => s.notify);
  const pending = pendingAssumptions(model);
  const review = reviewModel(model);
  const aiModel = model.metadata.templateId?.startsWith("ai:") || model.parameters.some((p) => p.source === "ai");
  if (!aiModel && pending.length === 0) return null;

  const nodeFor = (pid: string) => model.nodes.find((n) => Object.values(n.parameters).includes(pid));

  return (
    <Box>
      {pending.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
            <AutoAwesomeIcon sx={{ fontSize: 16, color: tokens.simulation, mr: 0.75 }} />
            <Typography sx={{ fontWeight: 600, flex: 1 }}>
              {pending.length} AI suggestion{pending.length === 1 ? "" : "s"} to review
            </Typography>
            <Button size="small" onClick={() => apply(acceptAll)}>
              Accept all
            </Button>
          </Stack>
          <Stack spacing={1}>
            {pending.map((p) => {
              const node = nodeFor(p.id);
              return (
                <Box key={p.id} sx={{ p: 1.25, border: 1, borderColor: `${tokens.simulation}55`, borderRadius: 1.5, bgcolor: `${tokens.simulation}08` }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                      {p.name}
                    </Typography>
                    <Typography variant="body2" className="num" sx={{ fontWeight: 600 }}>
                      {formatByUnit(p.value, p.unit, model.settings.currency as Currency)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }}>
                    <Chip size="small" label="AI suggested" color="secondary" variant="outlined" />
                    {p.confidence && <Chip size="small" label={`Confidence: ${p.confidence}`} variant="outlined" />}
                  </Stack>
                  {p.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      {p.description}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button size="small" variant="contained" color="secondary" onClick={() => apply((m) => acceptAssumption(m, p.id))}>
                      Accept
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!node}
                      onClick={() => {
                        setMode("build");
                        if (node) select([node.id]);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        const r = rejectAssumption(model, p.id);
                        apply(() => r.model);
                        notify(describeRejection(r.outcome, p.name, r.nodeLabels), r.outcome === "marked-rejected" ? "warning" : "info");
                      }}
                    >
                      Reject
                    </Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
      <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Model review · simulation confidence: {review.confidence}</Typography>
      {review.items.map((i) => (
        <Typography key={i.label} variant="body2" color={i.ok ? "success.main" : "warning.main"} title={i.ok ? undefined : i.hint}>
          {i.ok ? "✓" : "⚠"} {i.label}
          {!i.ok && (
            <Typography component="span" variant="caption" color="text.secondary">
              {" "}
              — {i.hint}
            </Typography>
          )}
        </Typography>
      ))}
    </Box>
  );
}
