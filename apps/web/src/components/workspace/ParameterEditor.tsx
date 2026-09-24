"use client";

import { KNOWN_UNITS } from "@fin/formula-engine";
import { CONFIDENCE_LEVELS, PARAMETER_SOURCES, type Distribution, type Parameter, type SlotSpec } from "@fin/model-schema";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { distributionForLevel, uncertaintyLevel, UNCERTAINTY_LABELS, type UncertaintyLevel } from "@/lib/uncertainty";
import { formatByUnit, type Currency } from "@/lib/format";
import { effectiveValue, overrideSource } from "@/lib/scenario-ops";
import { useEditor } from "@/store/editor-store";
import { NumberInput, TextInput, unitPresentation } from "./NumberInput";

const SOURCE_LABELS: Record<string, string> = {
  user: "User assumption",
  ai: "AI suggested",
  template: "Template",
  benchmark: "Market benchmark",
  imported: "Imported actual",
};

const DISTRIBUTION_TYPES: Distribution["type"][] = ["fixed", "uniform", "normal", "triangular", "lognormal"];

export function ParameterEditor({ param, slot }: { param: Parameter; slot: SlotSpec }) {
  const setValue = useEditor((s) => s.setParameterValue);
  const model = useEditor((s) => s.model)!;
  const activeScenarioId = useEditor((s) => s.activeScenarioId);
  const resetOverride = useEditor((s) => s.resetOverride);
  const activeScenario = model.scenarios.find((x) => x.id === activeScenarioId);
  const value = activeScenario ? effectiveValue(model, activeScenario.id, param.id) : param.value;
  const overriddenBy = activeScenario ? overrideSource(model, activeScenario.id, param.id) : null;
  const update = useEditor((s) => s.updateParameter);
  const validation = useEditor((s) => s.validation);
  const issues = validation?.issues.filter((i) => i.parameterId === param.id);
  const pres = unitPresentation(param.unit);
  const level = uncertaintyLevel(param);
  const bounds = { min: param.min ?? slot.range?.min, max: param.max ?? slot.range?.max };
  const errors = issues?.filter((i) => i.severity === "error") ?? [];

  const onValue = (v: number | undefined) => {
    if (v === undefined) return;
    const extra = !activeScenario && level !== "custom" && level !== "none" ? { distribution: distributionForLevel(v, level, bounds) } : {};
    setValue(param.id, v, extra);
  };

  return (
    <Box sx={{ py: 1 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.75 }} title={slot.description}>
        {slot.label}
      </Typography>
      <NumberInput
        fullWidth
        value={value}
        onCommit={onValue}
        scale={pres.scale}
        prefix={pres.prefix}
        suffix={pres.suffix}
        error={errors.length > 0}
        helperText={errors[0]?.message ?? slot.description}
        slotProps={{ htmlInput: { "aria-label": slot.label } }}
        sx={overriddenBy ? { "& .MuiOutlinedInput-notchedOutline": { borderColor: "secondary.main" } } : undefined}
      />
      {activeScenario && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
          {overriddenBy ? (
            <>
              <Chip size="small" color="secondary" variant="outlined" label={`${overriddenBy.id === activeScenario.id ? "Overridden" : `Inherited from ${overriddenBy.name}`} · base ${formatByUnit(param.value, param.unit, model.settings.currency as Currency)}`} />
              {overriddenBy.id === activeScenario.id && (
                <Button size="small" onClick={() => resetOverride(param.id)}>
                  Reset to base
                </Button>
              )}
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Base value — editing creates an override in “{activeScenario.name}”.
            </Typography>
          )}
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
        <TextField
          select
          size="small"
          label="Uncertainty"
          value={level}
          fullWidth
          onChange={(e) => {
            const l = e.target.value as UncertaintyLevel;
            if (l !== "custom") update(param.id, { distribution: distributionForLevel(param.value, l, bounds) });
          }}
        >
          {(Object.keys(UNCERTAINTY_LABELS) as UncertaintyLevel[]).map((l) => (
            <MenuItem key={l} value={l} disabled={l === "custom" || (l !== "none" && param.value === 0)}>
              {UNCERTAINTY_LABELS[l]}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Source" value={param.source} fullWidth onChange={(e) => update(param.id, { source: e.target.value as Parameter["source"] })}>
          {PARAMETER_SOURCES.map((s) => (
            <MenuItem key={s} value={s}>
              {SOURCE_LABELS[s]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Accordion disableGutters elevation={0} sx={{ mt: 1, "&:before": { display: "none" }, bgcolor: "transparent" }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 0, minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
          <Typography variant="caption" color="text.secondary">
            Advanced
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <Stack spacing={1.25}>
            <TextInput label="Name" value={param.name} required onCommit={(name) => update(param.id, { name })} />
            <TextField select size="small" label="Unit" value={param.unit} onChange={(e) => update(param.id, { unit: e.target.value })}>
              {[...new Set([param.unit, ...KNOWN_UNITS, "USD/customers", "INR/customers", "USD/credits", "users"])].map((u) => (
                <MenuItem key={u} value={u}>
                  {u}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1}>
              <NumberInput label="Minimum" value={param.min} scale={pres.scale} onCommit={(v) => update(param.id, { min: v })} />
              <NumberInput label="Maximum" value={param.max} scale={pres.scale} onCommit={(v) => update(param.id, { max: v })} />
            </Stack>
            <DistributionEditor param={param} scale={pres.scale} />
            <TextField select size="small" label="Confidence" value={param.confidence ?? ""} onChange={(e) => update(param.id, { confidence: (e.target.value || undefined) as Parameter["confidence"] })}>
              <MenuItem value="">Not set</MenuItem>
              {CONFIDENCE_LEVELS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </MenuItem>
              ))}
            </TextField>
            <TextInput label="Description / source notes" multiline minRows={2} value={param.description ?? ""} onCommit={(d) => update(param.id, { description: d || undefined })} />
            {issues?.filter((i) => i.severity === "warning").map((i) => (
              <Typography key={i.message} variant="caption" color="warning.main">
                {i.message}
              </Typography>
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

function DistributionEditor({ param, scale }: { param: Parameter; scale: number }) {
  const update = useEditor((s) => s.updateParameter);
  const d = param.distribution ?? { type: "fixed" as const };
  const set = (next: Distribution) => update(param.id, { distribution: next.type === "fixed" ? undefined : next });
  const v = param.value;

  const field = (label: string, value: number | undefined, onCommit: (x: number) => void) => (
    <NumberInput label={label} value={value} scale={scale} onCommit={(x) => x !== undefined && onCommit(x)} />
  );

  return (
    <Stack spacing={1}>
      <TextField
        select
        size="small"
        label="Distribution (for Monte Carlo)"
        value={d.type}
        onChange={(e) => {
          const t = e.target.value as Distribution["type"];
          const spread = Math.abs(v) * 0.2 || 1;
          const presets: Record<string, Distribution> = {
            fixed: { type: "fixed" },
            uniform: { type: "uniform", min: v - spread, max: v + spread },
            normal: { type: "normal", mean: v, stdDev: spread / 2 },
            triangular: { type: "triangular", min: v - spread, mode: v, max: v + spread },
            lognormal: { type: "lognormal", mean: Math.abs(v) || 1, stdDev: spread / 2 },
          };
          set(presets[t]!);
        }}
      >
        {DISTRIBUTION_TYPES.map((t) => (
          <MenuItem key={t} value={t}>
            {t === "lognormal" ? "Log-normal" : t[0]!.toUpperCase() + t.slice(1)}
          </MenuItem>
        ))}
      </TextField>
      {d.type === "uniform" && (
        <Stack direction="row" spacing={1}>
          {field("Worst case", d.min, (x) => set({ ...d, min: x }))}
          {field("Best case", d.max, (x) => set({ ...d, max: x }))}
        </Stack>
      )}
      {d.type === "triangular" && (
        <Stack direction="row" spacing={1}>
          {field("Worst", d.min, (x) => set({ ...d, min: x }))}
          {field("Most likely", d.mode, (x) => set({ ...d, mode: x }))}
          {field("Best", d.max, (x) => set({ ...d, max: x }))}
        </Stack>
      )}
      {(d.type === "normal" || d.type === "lognormal") && (
        <Stack direction="row" spacing={1}>
          {field("Mean", d.mean ?? v, (x) => set({ ...d, mean: x } as Distribution))}
          {field("Std. deviation", d.stdDev, (x) => set({ ...d, stdDev: x }))}
        </Stack>
      )}
    </Stack>
  );
}
