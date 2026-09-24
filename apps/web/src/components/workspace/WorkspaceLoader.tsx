"use client";

import type { Model } from "@fin/model-schema";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadModel } from "@/lib/storage";
import type { Mode } from "@/store/editor-store";

// The canvas, engine and editor load only on model pages (lazy, client-only).
const Workspace = dynamic(() => import("./Workspace"), {
  ssr: false,
  loading: () => (
    <Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}>
      <CircularProgress size={28} />
    </Box>
  ),
});

export function WorkspaceLoader({ id, mode }: { id: string; mode: Mode }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "missing" } | { status: "ready"; model: Model }>({ status: "loading" });

  useEffect(() => {
    const model = loadModel(id);
    setState(model ? { status: "ready", model } : { status: "missing" });
  }, [id]);

  if (state.status === "loading") return null;
  if (state.status === "missing") {
    return (
      <Box sx={{ height: "100vh", display: "grid", placeItems: "center", textAlign: "center", px: 2 }}>
        <Box>
          <Typography variant="h2" gutterBottom>
            Model not found
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Models are saved in this browser. This one may have been deleted or created on another device.
          </Typography>
          <Button component={Link} href="/app" variant="contained">
            Back to models
          </Button>
        </Box>
      </Box>
    );
  }
  return <Workspace model={state.model} initialMode={mode} />;
}
