"use client";

import type { AIStatus } from "@fin/ai";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Link from "next/link";

/** Explains how to enable local AI when Ollama is not reachable. */
export function AIStatusNotice({ status, onRetry }: { status: AIStatus | null; onRetry?(): void }) {
  if (!status) return null;
  if (!status.enabled) return <Alert severity="info">AI is turned off on this deployment. Everything else works without it.</Alert>;
  if (!status.reachable) {
    return (
      <Alert severity="warning" action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : undefined}>
        Local AI is not reachable{status.baseUrl ? ` at ${status.baseUrl}` : ""}. Install Ollama, run <code>ollama serve</code> and <code>ollama pull gpt-oss:20b</code>, then retry.
        {status.error ? ` (${status.error})` : ""}
      </Alert>
    );
  }
  if (status.models.length === 0) return <Alert severity="warning">Ollama is running but has no models. Run <code>ollama pull gpt-oss:20b</code>.</Alert>;
  return null;
}

export function SettingsLink() {
  return (
    <Button component={Link} href="/app/settings" size="small">
      AI settings
    </Button>
  );
}
