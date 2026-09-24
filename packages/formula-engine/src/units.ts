import type { FormulaNode } from "./ast";
import { parseFormula } from "./parser";

/**
 * Dimensional analysis for formulas. A unit is a map of base dimensions to
 * exponents: "USD/customers" → { USD: 1, customers: -1 }. Percent and plain
 * numbers are dimensionless ({}). Currency, count and time units are all
 * distinct dimensions, so `20 customers + $500` is flagged.
 */
export type UnitDims = Readonly<Record<string, number>>;

export const CURRENCY_UNITS = ["USD", "INR"] as const;
export const COUNT_UNITS = ["customers", "users", "credits", "units"] as const;
export const TIME_UNITS = ["months", "years"] as const;
export const DIMENSIONLESS_UNITS = ["percent", "number"] as const;

export const KNOWN_UNITS = [...CURRENCY_UNITS, ...COUNT_UNITS, ...TIME_UNITS, ...DIMENSIONLESS_UNITS] as const;
export type KnownUnit = (typeof KNOWN_UNITS)[number];

const ALIASES: Record<string, string> = {
  $: "USD",
  usd: "USD",
  "₹": "INR",
  inr: "INR",
  customer: "customers",
  user: "users",
  credit: "credits",
  unit: "units",
  month: "months",
  mo: "months",
  year: "years",
  yr: "years",
  "%": "percent",
  pct: "percent",
  count: "number",
  "": "number",
};

const DIMENSIONLESS = new Set<string>(DIMENSIONLESS_UNITS);

function canonical(token: string): string {
  const t = token.trim();
  return ALIASES[t] ?? ALIASES[t.toLowerCase()] ?? t;
}

/** Parses "USD", "USD/customers", "users/month", "USD*months" into dimensions. */
export function parseUnit(unit: string | undefined | null): UnitDims {
  if (!unit) return {};
  const dims: Record<string, number> = {};
  const [numerator = "", ...denominators] = unit.split("/");
  const add = (part: string, sign: number) => {
    for (const raw of part.split(/[*·]/)) {
      const name = canonical(raw);
      if (DIMENSIONLESS.has(name)) continue;
      dims[name] = (dims[name] ?? 0) + sign;
      if (dims[name] === 0) delete dims[name];
    }
  };
  add(numerator, 1);
  for (const d of denominators) add(d, -1);
  return dims;
}

export function isKnownUnit(unit: string): boolean {
  return unit
    .split("/")
    .flatMap((p) => p.split(/[*·]/))
    .every((t) => (KNOWN_UNITS as readonly string[]).includes(canonical(t)));
}

export function formatUnit(dims: UnitDims): string {
  const num = Object.entries(dims).filter(([, e]) => e > 0).sort(([a], [b]) => a.localeCompare(b));
  const den = Object.entries(dims).filter(([, e]) => e < 0).sort(([a], [b]) => a.localeCompare(b));
  const fmt = (list: [string, number][]) => list.map(([n, e]) => (Math.abs(e) === 1 ? n : `${n}^${Math.abs(e)}`)).join("·");
  if (num.length === 0 && den.length === 0) return "number";
  return (num.length ? fmt(num) : "1") + (den.length ? `/${fmt(den)}` : "");
}

export function sameUnit(a: UnitDims, b: UnitDims): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

function combine(a: UnitDims, b: UnitDims, sign: 1 | -1): UnitDims {
  const out: Record<string, number> = { ...a };
  for (const [k, e] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + sign * e;
    if (out[k] === 0) delete out[k];
  }
  return out;
}

function scale(a: UnitDims, factor: number): UnitDims | null {
  const out: Record<string, number> = {};
  for (const [k, e] of Object.entries(a)) {
    const v = e * factor;
    if (!Number.isInteger(v)) return null;
    if (v !== 0) out[k] = v;
  }
  return out;
}

export interface UnitWarning {
  message: string;
  position: number;
}

export interface UnitCheckResult {
  /** Inferred result unit, or null when it cannot be determined (e.g. only literals). */
  unit: UnitDims | null;
  warnings: UnitWarning[];
}

/** `null` means "unknown": literals and variables without a declared unit adapt to context. */
type Inferred = UnitDims | null;

/**
 * Infers the unit of a formula and reports suspicious combinations.
 * These are warnings, never errors: the formula still evaluates.
 */
export function checkUnits(
  formula: string | FormulaNode,
  variableUnits: Readonly<Record<string, string | undefined>>,
): UnitCheckResult {
  const ast = typeof formula === "string" ? parseFormula(formula) : formula;
  const warnings: UnitWarning[] = [];

  const unify = (units: Inferred[], pos: number, verb: string): Inferred => {
    const known = units.filter((u): u is UnitDims => u !== null);
    if (known.length === 0) return null;
    const first = known[0]!;
    for (const u of known.slice(1)) {
      if (!sameUnit(first, u)) {
        warnings.push({ message: `${verb} values with different units (${formatUnit(first)} and ${formatUnit(u)}).`, position: pos });
        return first;
      }
    }
    return first;
  };

  const infer = (n: FormulaNode): Inferred => {
    switch (n.kind) {
      case "number":
        return null;
      case "identifier": {
        const u = variableUnits[n.name];
        return u === undefined ? null : parseUnit(u);
      }
      case "percent":
        infer(n.arg);
        return {};
      case "unary":
        return infer(n.arg);
      case "binary": {
        const l = infer(n.left);
        const r = infer(n.right);
        switch (n.op) {
          case "+":
            return unify([l, r], n.pos, "Adding");
          case "-":
            return unify([l, r], n.pos, "Subtracting");
          case "*":
            if (l === null) return r;
            if (r === null) return l;
            return combine(l, r, 1);
          case "/":
            if (r === null) return l;
            if (l === null) return null;
            return combine(l, r, -1);
          case "^": {
            if (l === null || Object.keys(l).length === 0) return l;
            if (n.right.kind === "number") {
              const scaled = scale(l, Number(n.right.value));
              if (scaled) return scaled;
            }
            warnings.push({ message: `Raising a value in ${formatUnit(l)} to a non-integer or variable power.`, position: n.pos });
            return null;
          }
          default:
            unify([l, r], n.pos, "Comparing");
            return {};
        }
      }
      case "call": {
        const args = n.args.map(infer);
        switch (n.name) {
          case "min":
          case "max":
          case "sum":
          case "average":
            return unify(args, n.pos, `${n.name}() of`);
          case "abs":
          case "round":
          case "floor":
          case "ceil":
          case "previous":
          case "lag":
          case "mod":
            return args[0] ?? null;
          case "sqrt": {
            const a = args[0] ?? null;
            if (a === null) return null;
            const s = scale(a, 0.5);
            if (!s) warnings.push({ message: `Square root of a value in ${formatUnit(a)} has no meaningful unit.`, position: n.pos });
            return s;
          }
          case "pow": {
            const a = args[0] ?? null;
            if (a !== null && Object.keys(a).length > 0) {
              warnings.push({ message: `pow() of a value in ${formatUnit(a)}; use ^ with a whole-number exponent instead.`, position: n.pos });
              return null;
            }
            return a;
          }
          case "if":
            return unify([args[1] ?? null, args[2] ?? null], n.pos, "if() branches return");
          case "growth":
          case "and":
          case "or":
          case "not":
            return {};
          default:
            return null;
        }
      }
    }
  };

  return { unit: infer(ast), warnings };
}
