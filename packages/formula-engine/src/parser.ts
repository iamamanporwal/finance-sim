import type { BinaryOperator, FormulaNode } from "./ast";
import { FormulaError, MAX_AST_DEPTH } from "./errors";
import { FUNCTIONS, HISTORY_FUNCTIONS } from "./functions";
import { tokenize, type Token } from "./tokenizer";

const COMPARISON = new Set([">", ">=", "<", "<=", "==", "!="]);

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    if (this.peek().type === "eof") throw new FormulaError("syntax", "Formula is empty.", 0);
    const node = this.comparison();
    const next = this.peek();
    if (next.type !== "eof") {
      throw new FormulaError("syntax", `Unexpected "${next.value}".`, next.pos);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    return this.tokens[this.index++]!;
  }

  private isOperator(...ops: string[]): boolean {
    const t = this.peek();
    return t.type === "operator" && ops.includes(t.value);
  }

  private enter(pos: number) {
    if (++this.depth > MAX_AST_DEPTH) {
      throw new FormulaError("limit", `Formula is nested too deeply (max ${MAX_AST_DEPTH}).`, pos);
    }
  }

  private leave() {
    this.depth--;
  }

  private comparison(): FormulaNode {
    let left = this.additive();
    while (this.peek().type === "operator" && COMPARISON.has(this.peek().value)) {
      const op = this.advance();
      const right = this.additive();
      left = { kind: "binary", op: op.value as BinaryOperator, left, right, pos: op.pos };
    }
    return left;
  }

  private additive(): FormulaNode {
    let left = this.multiplicative();
    while (this.isOperator("+", "-")) {
      const op = this.advance();
      const right = this.multiplicative();
      left = { kind: "binary", op: op.value as BinaryOperator, left, right, pos: op.pos };
    }
    return left;
  }

  private multiplicative(): FormulaNode {
    let left = this.unary();
    while (this.isOperator("*", "/")) {
      const op = this.advance();
      const right = this.unary();
      left = { kind: "binary", op: op.value as BinaryOperator, left, right, pos: op.pos };
    }
    return left;
  }

  private unary(): FormulaNode {
    if (this.isOperator("-", "+")) {
      const op = this.advance();
      this.enter(op.pos);
      const arg = this.unary();
      this.leave();
      return { kind: "unary", op: op.value as "-" | "+", arg, pos: op.pos };
    }
    return this.power();
  }

  /** Right-associative; binds tighter than unary minus so -2^2 = -4. */
  private power(): FormulaNode {
    const base = this.postfix();
    if (this.isOperator("^")) {
      const op = this.advance();
      this.enter(op.pos);
      const exponent = this.unary();
      this.leave();
      return { kind: "binary", op: "^", left: base, right: exponent, pos: op.pos };
    }
    return base;
  }

  private postfix(): FormulaNode {
    let node = this.primary();
    while (this.isOperator("%")) {
      const op = this.advance();
      node = { kind: "percent", arg: node, pos: op.pos };
    }
    return node;
  }

  private primary(): FormulaNode {
    const token = this.advance();
    switch (token.type) {
      case "number":
        return { kind: "number", value: token.value, pos: token.pos };
      case "identifier": {
        if (this.peek().type === "lparen") return this.call(token);
        return { kind: "identifier", name: token.value, pos: token.pos };
      }
      case "lparen": {
        this.enter(token.pos);
        const inner = this.comparison();
        this.leave();
        this.expect("rparen", `Missing ")" to close "(" at position ${token.pos + 1}.`);
        return inner;
      }
      case "eof":
        throw new FormulaError("syntax", "Formula ends unexpectedly.", token.pos);
      default:
        throw new FormulaError("syntax", `Unexpected "${token.value}".`, token.pos);
    }
  }

  private call(nameToken: Token): FormulaNode {
    const name = nameToken.value.toLowerCase();
    const spec = FUNCTIONS[name];
    if (!spec) throw new FormulaError("syntax", `Unknown function "${nameToken.value}".`, nameToken.pos);
    this.advance(); // (
    this.enter(nameToken.pos);
    const args: FormulaNode[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.comparison());
      while (this.peek().type === "comma") {
        this.advance();
        args.push(this.comparison());
      }
    }
    this.leave();
    this.expect("rparen", `Missing ")" after arguments of ${name}().`);
    if (args.length < spec.min || args.length > spec.max) {
      const expected = spec.min === spec.max ? `${spec.min}` : spec.max === Infinity ? `at least ${spec.min}` : `${spec.min}–${spec.max}`;
      throw new FormulaError("syntax", `${name}() expects ${expected} argument(s), got ${args.length}.`, nameToken.pos);
    }
    if (HISTORY_FUNCTIONS.has(name) && args[0]!.kind !== "identifier") {
      throw new FormulaError("syntax", `${name}() needs a variable name as its first argument.`, nameToken.pos);
    }
    return { kind: "call", name, args, pos: nameToken.pos };
  }

  private expect(type: Token["type"], message: string) {
    const token = this.peek();
    if (token.type !== type) throw new FormulaError("syntax", message, token.pos);
    this.advance();
  }
}

export function parseFormula(source: string): FormulaNode {
  return new Parser(tokenize(source)).parse();
}

/** Collects every variable name referenced by a formula (including inside previous()/lag()). */
export function collectIdentifiers(node: FormulaNode, out: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case "identifier":
      out.add(node.name);
      break;
    case "unary":
    case "percent":
      collectIdentifiers(node.arg, out);
      break;
    case "binary":
      collectIdentifiers(node.left, out);
      collectIdentifiers(node.right, out);
      break;
    case "call":
      node.args.forEach((a) => collectIdentifiers(a, out));
      break;
  }
  return out;
}
