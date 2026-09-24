"use client";
import { createTheme } from "@mui/material/styles";

/** Neutral, calm palette from the PRD. Color is reserved for meaning. */
export const tokens = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#111827",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  primary: "#4F46E5",
  positive: "#16A34A",
  warning: "#D97706",
  risk: "#DC2626",
  info: "#2563EB",
  simulation: "#7C3AED",
} as const;

/** Node category colors — communicate category only. */
export const categoryColors: Record<string, string> = {
  inputs: "#3B82F6",
  customers: "#8B5CF6",
  revenue: "#10B981",
  costs: "#F97316",
  resources: "#06B6D4",
  logic: "#64748B",
};

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: tokens.primary },
    secondary: { main: tokens.simulation },
    success: { main: tokens.positive },
    warning: { main: tokens.warning },
    error: { main: tokens.risk },
    info: { main: tokens.info },
    background: { default: tokens.background, paper: tokens.surface },
    text: { primary: tokens.text, secondary: tokens.textSecondary },
    divider: tokens.border,
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: "var(--font-roboto), Roboto, system-ui, sans-serif",
    fontSize: 14,
    h1: { fontSize: 30, fontWeight: 600 },
    h2: { fontSize: 22, fontWeight: 600 },
    h3: { fontSize: 18, fontWeight: 600 },
    h4: { fontSize: 16, fontWeight: 600 },
    body1: { fontSize: 14 },
    body2: { fontSize: 13 },
    caption: { fontSize: 12 },
    button: { textTransform: "none", fontWeight: 500 },
  },
  components: {
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: "none" } } },
    MuiCard: { styleOverrides: { root: { border: `1px solid ${tokens.border}` } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
