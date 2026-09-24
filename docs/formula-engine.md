# Formula Engine (`@fin/formula-engine`)

A small, sandboxed expression language for FORMULA nodes. It never calls `eval`
or `Function` and never executes JavaScript. Source text becomes tokens, then an
AST, then a tree-walking evaluator over Decimal.js values.

## Syntax

| Kind | Supported |
|---|---|
| Arithmetic | `+ - * /`, `^` (power, right-associative), unary `-`/`+`, `( )` |
| Percent | postfix `%`: `20%` = `0.2`, `(a + b)%`. `%` is **not** modulo; use `mod(a, b)` |
| Comparison | `> >= < <= == !=` → `1` or `0` |
| Functions | `min max sum average abs round(x, digits) floor ceil sqrt pow mod if and or not` |
| Time | `previous(x)`, `lag(x, n)`, `growth(x)`, and the reserved variable `period` (1-based) |
| Numbers | `1200`, `1_200`, `.5`, `1e3` |
| Names | `customers`, `customers.new` (letters, digits, `_`, `.`) |

`if()` is lazy, so `if(x > 0, y / x, 0)` is safe. History functions error in
early periods unless you guard them, for example `if(period > 1, previous(x), 0)`.

## Safety limits

- 2,000-character maximum and nesting depth 64.
- Unknown functions are parse errors. Unknown variables are evaluation errors.
- Variables resolve from own properties only (`constructor` and `toString` are never reachable).
- Division by zero, `sqrt` of a negative and non-finite results raise `FormulaError`.
  NaN or Infinity never escapes.

## Precision

All math uses an isolated Decimal.js clone (34 significant digits, ROUND_HALF_UP),
so `0.1 + 0.2 = 0.3` and cents never drift.

## Units

`checkUnits(formula, variableUnits)` infers the result unit and returns warnings
(never errors). Supported units are `USD INR customers users credits units months
years percent number`, plus compounds such as `USD/customers`.

- `price * customers` → `customers·USD`, which is fine.
- `cogs_per_customer * customers` → `USD`, which is fine.
- `customers + price` → warning: *Adding values with different units (customers and USD).*
- Literals adapt to the other operand (`price + 5` is fine). Percent is dimensionless.
