"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { recommendTemplates } from "@fin/templates";
import { applyExample, STARTER_EXAMPLES } from "@/lib/examples";
import { useEditor } from "@/store/editor-store";

/** Never show a blank canvas: offer a starting point. */
export function EmptyCanvas() {
  const apply = useEditor((s) => s.apply);
  const meta = useEditor((s) => s.model?.metadata);
  // Templates matching the onboarding answers come first.
  const order = recommendTemplates(meta?.stage, meta?.revenueModel).map((t) => t.id);
  const examples = [...STARTER_EXAMPLES].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).slice(0, 4);
  return (
    <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      <Paper sx={{ p: 3, maxWidth: 420, pointerEvents: "auto", border: 1, borderColor: "divider", textAlign: "center" }}>
        <Typography variant="h3" gutterBottom>
          Build your first business model
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Drag nodes from the library on the left and connect them — or start from an example and change its assumptions.
        </Typography>
        <Stack spacing={1}>
          {examples.map((ex) => (
            <Button key={ex.id} variant="contained" onClick={() => apply((m) => applyExample(m, ex))}>
              Start with {ex.name}
            </Button>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          Tip: press ⌘K to search for any node or command.
        </Typography>
      </Paper>
    </Box>
  );
}
