"use client";

import { getMetricDefinition } from "@fin/model-schema";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Tooltip from "@mui/material/Tooltip";

/** ⓘ tooltip explaining a financial term in plain language. */
export function MetricInfo({ metric, text }: { metric?: string; text?: string }) {
  const description = text ?? (metric ? getMetricDefinition(metric)?.description : undefined);
  if (!description) return null;
  return (
    <Tooltip title={description}>
      <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.disabled", ml: 0.5, verticalAlign: "-2px", cursor: "help" }} aria-label={description} />
    </Tooltip>
  );
}
