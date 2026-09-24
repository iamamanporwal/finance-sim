import type { SimulationSettings, TimeStep } from "@fin/model-schema";

export interface Period {
  /** 1-based period number. */
  index: number;
  /** Human label: "2027-01", "2027-Q1", "2027", or an ISO date for daily/weekly steps. */
  label: string;
  /** ISO date (YYYY-MM-DD) of the first day of the period. */
  startDate: string;
}

export const PERIODS_PER_YEAR: Readonly<Record<TimeStep, number>> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** Length of one time step in months (used to normalize MRR and runway). */
export function monthsPerPeriod(step: TimeStep): number {
  return 12 / PERIODS_PER_YEAR[step];
}

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseStart(startDate: string): YMD {
  const [y, m, d] = startDate.split("-").map(Number);
  return { y: y!, m: m!, d: d ?? 1 };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addMonths(start: YMD, months: number): YMD {
  const total = start.y * 12 + (start.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(start.d, daysInMonth(y, m)) };
}

function addDays(start: YMD, days: number): YMD {
  const date = new Date(Date.UTC(start.y, start.m - 1, start.d + days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (x: YMD) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;

/** Builds the list of simulation periods. Pure and deterministic (UTC calendar math only). */
export function buildPeriods(settings: Pick<SimulationSettings, "startDate" | "timeStep" | "horizon">): Period[] {
  const start = parseStart(settings.startDate);
  const periods: Period[] = [];
  for (let i = 0; i < settings.horizon; i++) {
    let date: YMD;
    let label: string;
    switch (settings.timeStep) {
      case "daily":
        date = addDays(start, i);
        label = iso(date);
        break;
      case "weekly":
        date = addDays(start, i * 7);
        label = iso(date);
        break;
      case "monthly":
        date = addMonths(start, i);
        label = `${date.y}-${pad(date.m)}`;
        break;
      case "quarterly":
        date = addMonths(start, i * 3);
        label = `${date.y}-Q${Math.floor((date.m - 1) / 3) + 1}`;
        break;
      case "yearly":
        date = addMonths(start, i * 12);
        label = `${date.y}`;
        break;
    }
    periods.push({ index: i + 1, label, startDate: iso(date) });
  }
  return periods;
}
