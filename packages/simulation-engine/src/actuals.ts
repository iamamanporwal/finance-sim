import { ACTUAL_FIELDS, type ActualPoint, type Model, type SimulationResult, type TimelinePoint } from "@fin/model-schema";

export type ActualField = (typeof ACTUAL_FIELDS)[number];

/** Where each actual field's forecast counterpart lives on a timeline point. */
const FORECAST_OF: Record<ActualField, (p: TimelinePoint) => number | null> = {
  revenue: (p) => p.revenue.total,
  mrr: (p) => p.metrics.mrr ?? null,
  customers: (p) => p.customers.closing,
  newCustomers: (p) => p.customers.new,
  churnedCustomers: (p) => p.customers.churned,
  cogs: (p) => p.costs.cogs,
  opex: (p) => p.costs.opex,
  cash: (p) => p.metrics.cash ?? null,
};

export interface ActualForecastRow {
  period: string;
  /** "actual": before the forecast starts. "forecast": simulated (may also have actuals to compare). */
  kind: "actual" | "forecast";
  /** 1-based forecast period, when simulated. */
  index: number | null;
  actual: Partial<Record<ActualField, number>>;
  forecast: Partial<Record<ActualField, number | null>>;
  /** (actual − forecast) ÷ |forecast| where both exist. */
  variance: Partial<Record<ActualField, number | null>>;
}

/**
 * Actual and forecast side by side, in calendar order:
 *   Jan Feb Mar Apr | May Jun Jul …
 *    A   A   A   A  |  F   F   F
 * Actuals that fall inside the forecast (entered after the model was built) are
 * compared with what the model forecast for that month.
 */
export function actualsVsForecast(model: Model, result: SimulationResult | null): ActualForecastRow[] {
  if (model.settings.timeStep !== "monthly" && model.actuals.length > 0 && result) {
    // Actuals are monthly; only monthly forecasts line up with them.
    return model.actuals.map((a) => ({ period: a.period, kind: "actual", index: null, actual: clean(a), forecast: {}, variance: {} }));
  }
  const byPeriod = new Map(model.actuals.map((a) => [a.period, a]));
  const start = (result?.timeline[0]?.period ?? model.settings.startDate).slice(0, 7);
  const rows: ActualForecastRow[] = [];
  for (const a of [...model.actuals].sort((x, y) => x.period.localeCompare(y.period))) {
    if (a.period < start) rows.push({ period: a.period, kind: "actual", index: null, actual: clean(a), forecast: {}, variance: {} });
  }
  for (const p of result?.timeline ?? []) {
    const key = p.period.slice(0, 7);
    const a = byPeriod.get(key);
    const actual = a ? clean(a) : {};
    const forecast: ActualForecastRow["forecast"] = {};
    const variance: ActualForecastRow["variance"] = {};
    for (const f of ACTUAL_FIELDS) {
      forecast[f] = FORECAST_OF[f](p);
      const av = actual[f];
      const fv = forecast[f];
      if (av !== undefined) variance[f] = fv === null || fv === undefined || fv === 0 ? null : (av - fv) / Math.abs(fv);
    }
    rows.push({ period: key, kind: "forecast", index: p.index, actual, forecast, variance });
  }
  return rows;
}

function clean(a: ActualPoint): Partial<Record<ActualField, number>> {
  return Object.fromEntries(Object.entries(a.values).filter(([, v]) => v !== undefined)) as Partial<Record<ActualField, number>>;
}

export interface ActualsAnchor {
  /** Last month with actual data. */
  lastActual: string;
  /** Forecast start: the month after the last actual. */
  startDate: string;
  customers?: number;
  cash?: number;
}

/** The starting point the latest actuals imply for the forecast (null when there are no actuals). */
export function anchorFromActuals(model: Pick<Model, "actuals">): ActualsAnchor | null {
  if (model.actuals.length === 0) return null;
  const sorted = [...model.actuals].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1]!;
  const latest = (f: "customers" | "cash") => [...sorted].reverse().find((a) => a.values[f] !== undefined)?.values[f];
  return { lastActual: last.period, startDate: addMonths(last.period, 1), customers: latest("customers"), cash: latest("cash") };
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CSV_ALIASES: Record<string, ActualField | "period"> = {
  period: "period", month: "period", date: "period",
  revenue: "revenue", mrr: "mrr", customers: "customers", "paying customers": "customers",
  "new customers": "newCustomers", newcustomers: "newCustomers", new: "newCustomers",
  churned: "churnedCustomers", "churned customers": "churnedCustomers", churnedcustomers: "churnedCustomers",
  cogs: "cogs", opex: "opex", expenses: "opex", "operating expenses": "opex", cash: "cash",
};

/**
 * Parses pasted CSV/TSV actuals: a header row (period/month + any of revenue, mrr,
 * customers, new customers, churned, cogs, opex, cash) then one row per month.
 * Money may include $ and thousands separators. Returns rows and readable errors.
 */
export function parseActualsCsv(text: string): { rows: ActualPoint[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ["Paste a header row and at least one month."] };
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : splitCsv(l)).map((c) => c.trim());
  const header = split(lines[0]!).map((h) => CSV_ALIASES[h.toLowerCase().replace(/[_]+/g, " ").trim()]);
  const periodCol = header.indexOf("period");
  if (periodCol < 0) return { rows: [], errors: ['The header needs a "period" or "month" column.'] };
  header.forEach((h, i) => {
    if (!h) errors.push(`Column "${split(lines[0]!)[i]}" is not recognized and was ignored.`);
  });
  const rows: ActualPoint[] = [];
  lines.slice(1).forEach((line, li) => {
    const cells = split(line);
    const period = normalizeMonth(cells[periodCol] ?? "");
    if (!period) {
      errors.push(`Row ${li + 2}: "${cells[periodCol]}" is not a month (use YYYY-MM).`);
      return;
    }
    const values: ActualPoint["values"] = {};
    header.forEach((h, i) => {
      if (!h || h === "period") return;
      const raw = (cells[i] ?? "").replace(/[$₹,\s]/g, "");
      if (raw === "") return;
      const v = Number(raw.replace(/^\((.*)\)$/, "-$1"));
      if (!Number.isFinite(v)) errors.push(`Row ${li + 2}: "${cells[i]}" is not a number.`);
      else values[h] = v;
    });
    rows.push({ period, values });
  });
  return { rows, errors };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function normalizeMonth(s: string): string | null {
  const t = s.trim().toLowerCase();
  let m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(t);
  if (m) return valid(+m[1]!, +m[2]!);
  m = /^(\d{1,2})[-/](\d{4})$/.exec(t);
  if (m) return valid(+m[2]!, +m[1]!);
  m = /^([a-z]{3})[a-z]*[\s-]+(\d{4})$/.exec(t);
  if (m && MONTHS.includes(m[1]!)) return valid(+m[2]!, MONTHS.indexOf(m[1]!) + 1);
  return null;
}

const valid = (y: number, m: number) => (m >= 1 && m <= 12 && y >= 1900 && y <= 2200 ? `${y}-${String(m).padStart(2, "0")}` : null);
