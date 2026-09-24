"use client";

import { BUSINESS_STAGES, type BusinessStage, type Model } from "@fin/model-schema";
import { instantiateTemplate, recommendTemplates } from "@fin/templates";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { BUSINESS_TYPES, GOALS, REVENUE_MODELS, STAGES } from "@/lib/business-context";
import { newId } from "@/lib/ids";
import { createBlankModel } from "@/lib/model-ops";
import { tokens } from "@/theme/theme";

const STEPS = ["What are you building?", "How do you make money?", "What is your stage?", "Your biggest questions", "Starting point"];

export interface WizardAnswers {
  name: string;
  businessType: string;
  revenueModel: string;
  stage: BusinessStage;
  goals: string[];
}

/** Onboarding: four questions, then a recommended starting point. Answers configure the dashboard, never the formulas. */
export function NewModelWizard({ open, onClose, onCreate, onDescribe }: { open: boolean; onClose(): void; onCreate(model: Model): void; onDescribe(answers: WizardAnswers): void }) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<WizardAnswers>({ name: "", businessType: "", revenueModel: "", stage: "seed", goals: [] });
  const canNext = step === 0 ? !!a.businessType : step === 1 ? !!a.revenueModel : true;
  const recommended = recommendTemplates(a.stage, a.revenueModel);

  const finish = (templateId: string | null) => {
    const id = newId("m");
    const base = templateId ? instantiateTemplate(templateId, id) : createBlankModel(a.name || "Untitled model", id);
    onCreate({
      ...base,
      name: a.name.trim() || base.name,
      metadata: { ...base.metadata, stage: a.stage, businessType: a.businessType, revenueModel: a.revenueModel, goals: a.goals },
    });
    setStep(0);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="wizard-title">
      <DialogTitle id="wizard-title">New model</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map((s) => (
            <Step key={s}>
              <StepLabel>{s}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Stack spacing={2}>
            <Typography variant="h3">What are you building?</Typography>
            <Choices options={BUSINESS_TYPES} value={a.businessType} onChange={(businessType) => setA({ ...a, businessType })} label="Business type" />
            <TextField label="Name (optional)" size="small" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} />
          </Stack>
        )}
        {step === 1 && (
          <Stack spacing={2}>
            <Typography variant="h3">How do you make money?</Typography>
            <Choices options={REVENUE_MODELS} value={a.revenueModel} onChange={(revenueModel) => setA({ ...a, revenueModel })} label="Revenue model" />
          </Stack>
        )}
        {step === 2 && (
          <Stack spacing={2}>
            <Typography variant="h3">What is your current stage?</Typography>
            <Choices options={BUSINESS_STAGES.map((s) => ({ id: s, label: STAGES[s].label }))} value={a.stage} onChange={(stage) => setA({ ...a, stage: stage as BusinessStage })} label="Stage" />
            <Typography variant="body2" color="text.secondary">
              {STAGES[a.stage].description} {STAGES[a.stage].reading}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Stage only changes what we show first and suggest. It never changes how the numbers are calculated.
            </Typography>
          </Stack>
        )}
        {step === 3 && (
          <Stack spacing={1}>
            <Typography variant="h3">What are your biggest questions?</Typography>
            <Typography variant="body2" color="text.secondary">
              We answer these on your dashboard, straight from the simulation.
            </Typography>
            {GOALS.map((g) => (
              <FormControlLabel
                key={g.id}
                control={<Checkbox checked={a.goals.includes(g.id)} onChange={(e) => setA({ ...a, goals: e.target.checked ? [...a.goals, g.id] : a.goals.filter((x) => x !== g.id) })} />}
                label={g.label}
              />
            ))}
          </Stack>
        )}
        {step === 4 && (
          <Stack spacing={1.5}>
            <Typography variant="h3">Pick a starting point</Typography>
            <Card sx={{ borderColor: `${tokens.simulation}66` }}>
              <CardActionArea sx={{ p: 2 }} onClick={() => onDescribe(a)}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <AutoAwesomeIcon sx={{ color: tokens.simulation }} />
                  <Typography sx={{ fontWeight: 600 }}>Describe my business with AI</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Local AI extracts your numbers; you review them before the model is built.
                </Typography>
              </CardActionArea>
            </Card>
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
              {recommended.map((t, i) => (
                <Card key={t.id}>
                  <CardActionArea sx={{ p: 2, height: "100%" }} onClick={() => finish(t.id)}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 600 }}>{t.name}</Typography>
                      {i === 0 && <Chip size="small" color="secondary" variant="outlined" label="Best match" />}
                      {t.sophisticated && <Chip size="small" variant="outlined" label="Advanced" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {t.description}
                    </Typography>
                  </CardActionArea>
                </Card>
              ))}
              <Card>
                <CardActionArea sx={{ p: 2, height: "100%" }} onClick={() => finish(null)}>
                  <Typography sx={{ fontWeight: 600 }}>Build from scratch</Typography>
                  <Typography variant="body2" color="text.secondary">
                    An empty canvas.
                  </Typography>
                </CardActionArea>
              </Card>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</Button>
        {step < 4 && (
          <Button variant="contained" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 3 && a.goals.length === 0 ? "Skip" : "Next"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function Choices({ options, value, onChange, label }: { options: readonly { id: string; label: string }[]; value: string; onChange(v: string): void; label: string }) {
  return (
    <ToggleButtonGroup exclusive value={value} onChange={(_, v: string | null) => v && onChange(v)} aria-label={label} sx={{ flexWrap: "wrap", gap: 1, "& .MuiToggleButton-root": { border: 1, borderColor: "divider", borderRadius: "8px !important", textTransform: "none", px: 2 } }}>
      {options.map((o) => (
        <ToggleButton key={o.id} value={o.id} color="primary">
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
