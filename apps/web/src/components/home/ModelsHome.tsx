"use client";

import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Chip from "@mui/material/Chip";
import { DescribeBusinessDialog } from "@/components/ai/DescribeBusinessDialog";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { STARTER_EXAMPLES } from "@/lib/examples";
import { newId } from "@/lib/ids";
import { createBlankModel } from "@/lib/model-ops";
import { deleteModel, listModels, saveModel, type ModelSummary } from "@/lib/storage";
import { tokens } from "@/theme/theme";

export function ModelsHome() {
  const router = useRouter();
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [confirm, setConfirm] = useState<ModelSummary | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);

  useEffect(() => setModels(listModels()), []);

  const open = (model: Parameters<typeof saveModel>[0]) => {
    saveModel(model);
    router.push(`/app/models/${model.id}`);
  };

  const starters = (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
      <Card sx={{ gridColumn: { sm: "1 / -1" }, borderColor: `${tokens.simulation}66` }}>
        <CardActionArea sx={{ p: 2 }} onClick={() => setDescribeOpen(true)}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <AutoAwesomeIcon sx={{ color: tokens.simulation }} />
            <Typography sx={{ fontWeight: 600 }}>Describe my business with AI</Typography>
            <Chip size="small" label="Recommended" color="secondary" variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Tell us how your business works in plain words. Local AI extracts the assumptions, you review them, and we build the model.
          </Typography>
        </CardActionArea>
      </Card>
      {STARTER_EXAMPLES.map((ex) => (
        <Card key={ex.id}>
          <CardActionArea sx={{ p: 2, height: "100%" }} onClick={() => open({ ...ex.build(), id: newId("m"), metadata: { templateId: ex.id, createdAt: new Date().toISOString() } })}>
            <Typography sx={{ fontWeight: 600 }}>{ex.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {ex.description}
            </Typography>
          </CardActionArea>
        </Card>
      ))}
      <Card>
        <CardActionArea sx={{ p: 2, height: "100%" }} onClick={() => open(createBlankModel())}>
          <Typography sx={{ fontWeight: 600 }}>Build from scratch</Typography>
          <Typography variant="body2" color="text.secondary">
            Start with an empty canvas and add nodes from the library.
          </Typography>
        </CardActionArea>
      </Card>
    </Box>
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box sx={{ height: 56, px: 3, display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Typography component={Link} href="/" sx={{ fontWeight: 700, color: tokens.primary, textDecoration: "none", flex: 1 }}>
          ◆ FinSim
        </Typography>
        <Button component={Link} href="/app/settings" size="small">
          Settings
        </Button>
      </Box>
      <Box sx={{ maxWidth: 960, mx: "auto", px: 2, py: 4 }}>
        {models === null ? null : models.length === 0 ? (
          <Stack spacing={2}>
            <Typography variant="h1">Build your first business model</Typography>
            <Typography color="text.secondary">Start with an example and change its assumptions, or build from scratch.</Typography>
            {starters}
          </Stack>
        ) : (
          <Stack spacing={3}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="h1">Your models</Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => open(createBlankModel())}>
                New model
              </Button>
            </Stack>
            <Stack spacing={1}>
              {models.map((m) => (
                <Card key={m.id} sx={{ display: "flex", alignItems: "center" }}>
                  <CardActionArea component={Link} href={`/app/models/${m.id}`} sx={{ p: 2, flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>{m.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {m.nodeCount} nodes · updated {new Date(m.updatedAt).toLocaleString()}
                    </Typography>
                  </CardActionArea>
                  <IconButton aria-label={`Delete ${m.name}`} sx={{ mr: 1 }} onClick={() => setConfirm(m)}>
                    <DeleteOutlineIcon />
                  </IconButton>
                </Card>
              ))}
            </Stack>
            <Typography variant="h3">Start something new</Typography>
            {starters}
            <Typography variant="caption" color="text.secondary">
              Models are saved in this browser only.
            </Typography>
          </Stack>
        )}
      </Box>
      <DescribeBusinessDialog
        open={describeOpen}
        onClose={() => setDescribeOpen(false)}
        onCreated={(m) => {
          setDescribeOpen(false);
          open(m);
        }}
      />
      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete “{confirm?.name}”?</DialogTitle>
        <DialogContent>
          <Typography>This removes the model from this browser. It cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              if (confirm) deleteModel(confirm.id);
              setModels(listModels());
              setConfirm(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
