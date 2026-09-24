"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AIStatusNotice } from "@/components/ai/AIStatusNotice";
import { effectiveModel, getSelectedModel, setSelectedModel, useAIStatus } from "@/lib/ai-client";
import { tokens } from "@/theme/theme";

export function SettingsView() {
  const { status, loading, refresh } = useAIStatus();
  const [selected, setSelected] = useState<string>("");
  useEffect(() => setSelected(getSelectedModel() ?? ""), []);
  const effective = effectiveModel(status);
  const gb = (n?: number) => (n ? `${(n / 1e9).toFixed(1)} GB` : "");

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box sx={{ height: 56, px: 3, display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Typography component={Link} href="/app" sx={{ fontWeight: 700, color: tokens.primary, textDecoration: "none" }}>
          ◆ FinSim
        </Typography>
      </Box>
      <Stack spacing={3} sx={{ maxWidth: 720, mx: "auto", px: 2, py: 4 }}>
        <Typography variant="h1">Settings</Typography>
        <Paper sx={{ p: 3, border: 1, borderColor: "divider" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="h3" sx={{ flex: 1 }}>
              AI provider
            </Typography>
            {status && <Chip size="small" color={status.reachable ? "success" : "default"} label={status.reachable ? "Connected" : "Not connected"} />}
            <Button size="small" onClick={refresh}>
              Test connection
            </Button>
          </Stack>
          {loading && <LinearProgress sx={{ my: 1 }} />}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Provider: Ollama (local){status?.baseUrl ? ` at ${status.baseUrl}` : ""}. The URL and default model come from the server’s <code>OLLAMA_BASE_URL</code> and <code>OLLAMA_MODEL</code> environment variables; your browser never contacts the provider directly.
          </Typography>
          <AIStatusNotice status={status} onRetry={refresh} />
          {status?.reachable && status.models.length > 0 && (
            <TextField
              select
              fullWidth
              label="Model"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setSelectedModel(e.target.value || undefined);
              }}
              helperText={`In use: ${effective ?? "none"}. Models with tool calling work best (e.g. gpt-oss:20b).`}
              sx={{ mt: 2 }}
            >
              <MenuItem value="">Server default{status.defaultModel ? ` (${status.defaultModel})` : ""}</MenuItem>
              {status.models.map((m) => (
                <MenuItem key={m.name} value={m.name}>
                  {m.name} <span style={{ color: tokens.textSecondary, marginLeft: 8 }}>{gb(m.size)}</span>
                </MenuItem>
              ))}
            </TextField>
          )}
        </Paper>
        <Paper sx={{ p: 3, border: 1, borderColor: "divider" }}>
          <Typography variant="h3" gutterBottom>
            How the AI is used
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The AI extracts assumptions from your descriptions and operates the model through validated tools. It never calculates financial results itself: every number comes from the simulation engine. AI-suggested assumptions are marked and wait for your approval.
          </Typography>
        </Paper>
      </Stack>
    </Box>
  );
}
