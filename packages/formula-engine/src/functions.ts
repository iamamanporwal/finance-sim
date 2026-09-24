/** Arity rules for built-in functions. `max: Infinity` means variadic. */
export interface FunctionSpec {
  min: number;
  max: number;
  description: string;
}

export const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = {
  min: { min: 1, max: Infinity, description: "Smallest of the arguments" },
  max: { min: 1, max: Infinity, description: "Largest of the arguments" },
  sum: { min: 1, max: Infinity, description: "Sum of the arguments" },
  average: { min: 1, max: Infinity, description: "Arithmetic mean of the arguments" },
  abs: { min: 1, max: 1, description: "Absolute value" },
  round: { min: 1, max: 2, description: "round(x, digits = 0), half away from zero" },
  floor: { min: 1, max: 1, description: "Round down" },
  ceil: { min: 1, max: 1, description: "Round up" },
  sqrt: { min: 1, max: 1, description: "Square root" },
  pow: { min: 2, max: 2, description: "pow(base, exponent)" },
  mod: { min: 2, max: 2, description: "Remainder of a / b" },
  if: { min: 3, max: 3, description: "if(condition, whenTrue, whenFalse)" },
  and: { min: 1, max: Infinity, description: "1 when every argument is non-zero" },
  or: { min: 1, max: Infinity, description: "1 when any argument is non-zero" },
  not: { min: 1, max: 1, description: "1 when the argument is zero" },
  previous: { min: 1, max: 1, description: "previous(name): value of name in the previous period" },
  lag: { min: 2, max: 2, description: "lag(name, n): value of name n periods ago" },
  growth: { min: 1, max: 1, description: "growth(name): period-over-period growth rate of name" },
};

/** Functions whose first argument must be a variable name (resolved against history). */
export const HISTORY_FUNCTIONS = new Set(["previous", "lag", "growth"]);
