"use client";

import type { SimulationEvent, SimulationResult } from "@fin/model-schema";
import CheckIcon from "@mui/icons-material/Check";
import ErrorIcon from "@mui/icons-material/Error";
import FlagIcon from "@mui/icons-material/Flag";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useRef } from "react";
import { tokens } from "@/theme/theme";

export type PeriodStatus = "critical" | "warning" | "milestone" | "ok";

export function periodStatus(events: readonly SimulationEvent[]): PeriodStatus {
  if (events.some((e) => e.severity === "critical")) return "critical";
  if (events.some((e) => e.severity === "warning")) return "warning";
  if (events.some((e) => e.type === "break_even")) return "milestone";
  return "ok";
}

const STATUS = {
  critical: { Icon: ErrorIcon, color: tokens.risk },
  warning: { Icon: WarningAmberIcon, color: tokens.warning },
  milestone: { Icon: FlagIcon, color: tokens.positive },
  ok: { Icon: CheckIcon, color: "#94A3B8" },
} as const;

/** M1 … Mn strip. Every simulated period is clickable and inspectable. */
export function Timeline({ result, selected, onSelect }: { result: SimulationResult; selected: number; onSelect(period: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefix = { daily: "D", weekly: "W", monthly: "M", quarterly: "Q", yearly: "Y" }[result.settings.timeStep];

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-period="${selected}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  return (
    <Box
      ref={ref}
      role="tablist"
      aria-label="Simulation periods"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSelect(Math.min(selected + 1, result.timeline.length));
        if (e.key === "ArrowLeft") onSelect(Math.max(selected - 1, 1));
      }}
      sx={{ display: "flex", gap: 0.5, overflowX: "auto", pb: 0.5, outline: "none" }}
    >
      {result.timeline.map((p) => {
        const events = result.events.filter((e) => e.period === p.index);
        const status = periodStatus(events);
        const { Icon, color } = STATUS[status];
        const isSel = p.index === selected;
        return (
          <Tooltip key={p.index} title={events.length ? events.map((e) => e.message).join(" · ") : p.period}>
            <ButtonBase
              role="tab"
              aria-selected={isSel}
              data-period={p.index}
              onClick={() => onSelect(p.index)}
              sx={{
                flexDirection: "column",
                minWidth: 52,
                py: 0.75,
                borderRadius: 1.5,
                border: 1,
                borderColor: isSel ? tokens.simulation : "divider",
                bgcolor: isSel ? `${tokens.simulation}14` : "background.paper",
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                {prefix}
                {p.index}
              </Typography>
              <Icon sx={{ fontSize: 14, color }} />
            </ButtonBase>
          </Tooltip>
        );
      })}
    </Box>
  );
}
