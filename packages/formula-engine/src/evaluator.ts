import type { FormulaNode } from "./ast";
import { Decimal, ONE, ZERO, dec, type DecimalInput } from "./decimal";
import { FormulaError } from "./errors";
import { collectIdentifiers, parseFormula } from "./parser";

export type VariableResolver = (name: string) => DecimalInput | undefined;

export interface EvaluationContext {
  /** Current-period variable values, as a map or a resolver function. */
  variables: Readonly<Record<string, DecimalInput>> | VariableResolver;
  /** Value of `name` from `lag` periods ago (lag ≥ 1). Needed for previous()/lag()/growth(). */
  history?: (name: string, lag: number) => DecimalInput | undefined;
}

const truthy = (d: Decimal) => !d.isZero();
const bool = (b: boolean) => (b ? ONE : ZERO);

function finite(value: Decimal, pos: number, what: string): Decimal {
  if (!value.isFinite()) throw new FormulaError("evaluation", `${what} produced a non-finite result.`, pos);
  return value;
}

export function evaluate(node: FormulaNode, ctx: EvaluationContext): Decimal {
  const lookup = (name: string, pos: number): Decimal => {
    const vars = ctx.variables;
    // Own properties only: names like "constructor" must never resolve through the prototype.
    const raw = typeof vars === "function" ? vars(name) : Object.hasOwn(vars, name) ? vars[name] : undefined;
    if (raw === undefined) throw new FormulaError("evaluation", `Unknown variable "${name}".`, pos);
    const value = dec(raw);
    if (!value.isFinite()) throw new FormulaError("evaluation", `Variable "${name}" is not a finite number.`, pos);
    return value;
  };

  const historic = (name: string, lag: number, pos: number): Decimal => {
    const raw = ctx.history?.(name, lag);
    if (raw === undefined) {
      throw new FormulaError(
        "evaluation",
        `No value for "${name}" ${lag} period(s) ago. Guard it with if(period > ${lag}, …, …).`,
        pos,
      );
    }
    return dec(raw);
  };

  const run = (n: FormulaNode): Decimal => {
    switch (n.kind) {
      case "number":
        return new Decimal(n.value);
      case "identifier":
        return lookup(n.name, n.pos);
      case "percent":
        return run(n.arg).div(100);
      case "unary": {
        const v = run(n.arg);
        return n.op === "-" ? v.neg() : v;
      }
      case "call":
        return call(n);
      case "binary": {
        const l = run(n.left);
        const r = run(n.right);
        switch (n.op) {
          case "+":
            return l.plus(r);
          case "-":
            return l.minus(r);
          case "*":
            return l.times(r);
          case "/":
            if (r.isZero()) throw new FormulaError("evaluation", "Division by zero.", n.pos);
            return l.div(r);
          case "^":
            if (l.isZero() && r.isNegative()) throw new FormulaError("evaluation", "Division by zero (0 raised to a negative power).", n.pos);
            if (l.isNegative() && !r.isInteger()) throw new FormulaError("evaluation", "Negative number raised to a fractional power.", n.pos);
            return finite(l.pow(r), n.pos, "Exponent");
          case ">":
            return bool(l.gt(r));
          case ">=":
            return bool(l.gte(r));
          case "<":
            return bool(l.lt(r));
          case "<=":
            return bool(l.lte(r));
          case "==":
            return bool(l.eq(r));
          case "!=":
            return bool(!l.eq(r));
        }
      }
    }
  };

  const call = (n: Extract<FormulaNode, { kind: "call" }>): Decimal => {
    const args = n.args;
    const all = () => args.map(run);
    switch (n.name) {
      case "min":
        return Decimal.min(...all());
      case "max":
        return Decimal.max(...all());
      case "sum":
        return all().reduce((a, b) => a.plus(b), ZERO);
      case "average":
        return all().reduce((a, b) => a.plus(b), ZERO).div(args.length);
      case "abs":
        return run(args[0]!).abs();
      case "round": {
        const digits = args[1] ? run(args[1]) : ZERO;
        if (!digits.isInteger() || digits.lt(0) || digits.gt(20)) {
          throw new FormulaError("evaluation", "round() digits must be a whole number from 0 to 20.", n.pos);
        }
        return run(args[0]!).toDecimalPlaces(digits.toNumber(), Decimal.ROUND_HALF_UP);
      }
      case "floor":
        return run(args[0]!).floor();
      case "ceil":
        return run(args[0]!).ceil();
      case "sqrt": {
        const v = run(args[0]!);
        if (v.isNegative()) throw new FormulaError("evaluation", "sqrt() of a negative number.", n.pos);
        return v.sqrt();
      }
      case "pow": {
        const [base, exp] = [run(args[0]!), run(args[1]!)];
        if (base.isZero() && exp.isNegative()) throw new FormulaError("evaluation", "Division by zero (0 raised to a negative power).", n.pos);
        if (base.isNegative() && !exp.isInteger()) throw new FormulaError("evaluation", "Negative number raised to a fractional power.", n.pos);
        return finite(base.pow(exp), n.pos, "pow()");
      }
      case "mod": {
        const [a, b] = [run(args[0]!), run(args[1]!)];
        if (b.isZero()) throw new FormulaError("evaluation", "Division by zero in mod().", n.pos);
        return a.mod(b);
      }
      case "if":
        // Lazy: only the chosen branch is evaluated, so guards like if(x > 0, y / x, 0) are safe.
        return truthy(run(args[0]!)) ? run(args[1]!) : run(args[2]!);
      case "and":
        return bool(args.every((a) => truthy(run(a))));
      case "or":
        return bool(args.some((a) => truthy(run(a))));
      case "not":
        return bool(!truthy(run(args[0]!)));
      case "previous":
        return historic(identName(args[0]!), 1, n.pos);
      case "lag": {
        const periods = run(args[1]!);
        if (!periods.isInteger() || periods.lt(1)) throw new FormulaError("evaluation", "lag() periods must be a whole number ≥ 1.", n.pos);
        return historic(identName(args[0]!), periods.toNumber(), n.pos);
      }
      case "growth": {
        const name = identName(args[0]!);
        const prev = historic(name, 1, n.pos);
        if (prev.isZero()) throw new FormulaError("evaluation", `growth(${name}) is undefined because the previous value is zero.`, n.pos);
        return lookup(name, n.pos).minus(prev).div(prev);
      }
      default:
        throw new FormulaError("evaluation", `Unknown function "${n.name}".`, n.pos);
    }
  };

  return run(node);
}

function identName(node: FormulaNode): string {
  if (node.kind !== "identifier") throw new FormulaError("syntax", "Expected a variable name.", node.pos);
  return node.name;
}

export interface CompiledFormula {
  source: string;
  ast: FormulaNode;
  /** Every variable the formula references. */
  identifiers: ReadonlySet<string>;
  evaluate(ctx: EvaluationContext): Decimal;
}

/** Parse once, evaluate many times (once per period / per Monte Carlo run). */
export function compileFormula(source: string): CompiledFormula {
  const ast = parseFormula(source);
  return {
    source,
    ast,
    identifiers: collectIdentifiers(ast),
    evaluate: (ctx) => evaluate(ast, ctx),
  };
}

export function evaluateFormula(source: string, variables: EvaluationContext["variables"] = {}): Decimal {
  return evaluate(parseFormula(source), { variables });
}
