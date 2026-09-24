"use client";

import { checkUnits, FormulaError, FUNCTIONS, parseFormula } from "@fin/formula-engine";
import { COMPARISON_OPERATORS, COST_CATEGORIES, formulaVariables, type ModelNode } from "@fin/model-schema";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { updateNode } from "@/lib/model-ops";
import { useEditor } from "@/store/editor-store";
import { NumberInput, TextInput } from "./NumberInput";

const CATEGORY_LABELS: Record<string, string> = {
  payroll: "Payroll",
  marketing: "Marketing",
  infrastructure: "Infrastructure / hosting",
  ai: "AI / tokens",
  payment: "Payment fees",
  rent: "Rent",
  software: "Software",
  other: "Other",
};

/** Type-specific node settings (non-numeric configuration). */
export function NodeConfigEditor({ node }: { node: ModelNode }) {
  const apply = useEditor((s) => s.apply);
  const setConfig = (config: unknown) => apply((m) => updateNode(m, node.id, { config }));

  switch (node.type) {
    case "GROWTH": {
      const c = node.config;
      return (
        <Stack spacing={1.25}>
          <TextField select size="small" label="Growth type" value={c.growthType} onChange={(e) => setConfig({ ...c, growthType: e.target.value })}>
            <MenuItem value="compound">Compound (% of last period)</MenuItem>
            <MenuItem value="linear">Linear (% of first period)</MenuItem>
            <MenuItem value="absolute">Absolute (fixed amount per period)</MenuItem>
          </TextField>
          <Stack direction="row" spacing={1}>
            <NumberInput label="Grow after period" value={c.startPeriod} onCommit={(v) => setConfig({ ...c, startPeriod: Math.max(1, Math.round(v ?? 1)) })} />
            <NumberInput label="Stop after period" value={c.endPeriod} placeholder="Never" onCommit={(v) => setConfig({ ...c, endPeriod: v === undefined ? undefined : Math.max(1, Math.round(v)) })} />
          </Stack>
        </Stack>
      );
    }
    case "CHURN":
      return (
        <TextField select size="small" label="Rate is" value={node.config.basis} onChange={(e) => setConfig({ basis: e.target.value })}>
          <MenuItem value="per_period">Per period (monthly)</MenuItem>
          <MenuItem value="annual">Annual (converted to the time step)</MenuItem>
        </TextField>
      );
    case "REVENUE":
      return (
        <TextField select size="small" label="Revenue type" value={node.config.revenueType} onChange={(e) => setConfig({ revenueType: e.target.value })} helperText="Only subscription revenue counts toward MRR.">
          <MenuItem value="subscription">Subscription (recurring)</MenuItem>
          <MenuItem value="usage">Usage</MenuItem>
          <MenuItem value="topup">Top-ups</MenuItem>
          <MenuItem value="other">Other</MenuItem>
        </TextField>
      );
    case "REVENUE_RECOGNITION":
      return (
        <TextField select size="small" label="Recognized revenue counts as" value={node.config.revenueType} onChange={(e) => setConfig({ revenueType: e.target.value })} helperText="Billed cash is deferred; only recognized revenue reaches the income statement.">
          <MenuItem value="subscription">Subscription (recurring)</MenuItem>
          <MenuItem value="usage">Usage</MenuItem>
          <MenuItem value="topup">Top-ups</MenuItem>
          <MenuItem value="other">Other</MenuItem>
        </TextField>
      );
    case "COST":
      return <CostConfig node={node} setConfig={setConfig} />;
    case "SPLIT":
      return <SplitConfig node={node} setConfig={setConfig} />;
    case "CONDITION": {
      const c = node.config;
      return (
        <Stack spacing={1.25}>
          <TextField select size="small" label="Condition: value is" value={c.operator} onChange={(e) => setConfig({ ...c, operator: e.target.value })}>
            {COMPARISON_OPERATORS.map((op) => (
              <MenuItem key={op} value={op}>
                {{ ">": "greater than", ">=": "at least", "<": "less than", "<=": "at most", "==": "equal to", "!=": "not equal to" }[op]} the threshold
              </MenuItem>
            ))}
          </TextField>
          <TextInput label="Timeline event when true (optional)" value={c.eventLabel ?? ""} onCommit={(t) => setConfig({ ...c, eventLabel: t || undefined })} />
        </Stack>
      );
    }
    case "FORMULA":
      return <FormulaConfig node={node} setConfig={setConfig} />;
    default:
      return null;
  }
}

function CostConfig({ node, setConfig }: { node: Extract<ModelNode, { type: "COST" }>; setConfig(c: unknown): void }) {
  const c = node.config;
  const tiers = c.tiers ?? [];
  return (
    <Stack spacing={1.25}>
      <TextField select size="small" label="Cost type" value={c.costType} onChange={(e) => setConfig({ ...c, costType: e.target.value, tiers: e.target.value === "step" ? tiers.length ? tiers : [{ upTo: 1000, cost: 500 }, { cost: 1000 }] : undefined })}>
        <MenuItem value="fixed">Fixed amount per period</MenuItem>
        <MenuItem value="variable">Per unit (volume × cost)</MenuItem>
        <MenuItem value="percentage">Percentage of an amount</MenuItem>
        <MenuItem value="step">Step (tiers by volume)</MenuItem>
        <MenuItem value="capacity">Capacity (whole units, e.g. staff per accounts)</MenuItem>
      </TextField>
      <Stack direction="row" spacing={1}>
        <TextField select size="small" fullWidth label="Counts as" value={c.costClass} onChange={(e) => setConfig({ ...c, costClass: e.target.value })}>
          <MenuItem value="cogs">COGS (cost to serve)</MenuItem>
          <MenuItem value="opex">Operating expense</MenuItem>
        </TextField>
        <TextField select size="small" fullWidth label="Category" value={c.category} onChange={(e) => setConfig({ ...c, category: e.target.value })}>
          {COST_CATEGORIES.map((k) => (
            <MenuItem key={k} value={k}>
              {CATEGORY_LABELS[k]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1}>
        <NumberInput label="Starts in period" value={c.startPeriod} placeholder="1" onCommit={(v) => setConfig({ ...c, startPeriod: v === undefined ? undefined : Math.max(1, Math.round(v)) })} />
        <NumberInput label="Ends after period" value={c.endPeriod} placeholder="Never" onCommit={(v) => setConfig({ ...c, endPeriod: v === undefined ? undefined : Math.max(1, Math.round(v)) })} />
      </Stack>
      {c.costType === "step" && (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            Tiers (volume up to → cost). Leave the last limit empty for “and above”.
          </Typography>
          {tiers.map((t, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <NumberInput label="Up to" value={t.upTo} placeholder="and above" onCommit={(v) => setConfig({ ...c, tiers: tiers.map((x, j) => (j === i ? { ...x, upTo: v } : x)) })} />
              <NumberInput label="Cost" prefix="$" value={t.cost} onCommit={(v) => setConfig({ ...c, tiers: tiers.map((x, j) => (j === i ? { ...x, cost: v ?? 0 } : x)) })} />
              <IconButton size="small" aria-label="Remove tier" disabled={tiers.length <= 1} onClick={() => setConfig({ ...c, tiers: tiers.filter((_, j) => j !== i) })}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={() => setConfig({ ...c, tiers: [...tiers, { cost: (tiers[tiers.length - 1]?.cost ?? 0) * 2 }] })} sx={{ alignSelf: "flex-start" }}>
            Add tier
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function SplitConfig({ node, setConfig }: { node: Extract<ModelNode, { type: "SPLIT" }>; setConfig(c: unknown): void }) {
  const branches = node.config.branches;
  const keyFor = (label: string) => {
    const base = label.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("") || "branch";
    const safe = /^[A-Za-z]/.test(base) ? base : `b${base}`;
    let key = safe;
    let i = 2;
    while (branches.some((b) => b.key === key)) key = `${safe}${i++}`;
    return key;
  };
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        Branches (set each share under Assumptions — shares must total 100%).
      </Typography>
      {branches.map((b, i) => (
        <Stack key={b.key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextInput fullWidth label={`Branch ${i + 1}`} value={b.label} required onCommit={(label) => setConfig({ branches: branches.map((x) => (x.key === b.key ? { ...x, label } : x)) })} />
          <IconButton size="small" aria-label="Remove branch" disabled={branches.length <= 1} onClick={() => setConfig({ branches: branches.filter((x) => x.key !== b.key) })}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: "flex-start" }} onClick={() => {
        const label = `Plan ${String.fromCharCode(65 + branches.length)}`;
        setConfig({ branches: [...branches, { key: keyFor(label), label }] });
      }}>
        Add branch
      </Button>
    </Stack>
  );
}

function FormulaConfig({ node, setConfig }: { node: Extract<ModelNode, { type: "FORMULA" }>; setConfig(c: unknown): void }) {
  const [draft, setDraft] = useState(node.config.expression);
  const parameters = useEditor((s) => s.model?.parameters);
  const check = useMemo(() => {
    try {
      const ast = parseFormula(draft);
      const units: Record<string, string | undefined> = { period: "number" };
      for (const [slot, pid] of Object.entries(node.parameters)) units[slot] = parameters?.find((p) => p.id === pid)?.unit;
      return { error: null, warnings: checkUnits(ast, units).warnings.map((w) => w.message) };
    } catch (e) {
      return { error: e instanceof FormulaError ? e.message + (e.position !== undefined ? ` (character ${e.position + 1})` : "") : String(e), warnings: [] };
    }
  }, [draft, node.parameters, parameters]);

  return (
    <Stack spacing={1}>
      <TextField
        size="small"
        label="Expression"
        multiline
        minRows={2}
        value={draft}
        error={!!check.error}
        helperText={check.error ?? "Each variable becomes an input you can connect or set."}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && draft !== node.config.expression && setConfig({ expression: draft })}
        slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 } } }}
      />
      {check.warnings.map((w) => (
        <Typography key={w} variant="caption" color="warning.main">
          Unit warning: {w}
        </Typography>
      ))}
      <Typography variant="caption" color="text.secondary">
        Variables: {formulaVariables(node.config.expression).join(", ") || "none"} · also <code>period</code>. Functions: {Object.keys(FUNCTIONS).join(", ")}. Use 20% for percentages.
      </Typography>
    </Stack>
  );
}
