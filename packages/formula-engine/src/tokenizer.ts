import { FormulaError, MAX_FORMULA_LENGTH } from "./errors";

export type TokenType = "number" | "identifier" | "operator" | "lparen" | "rparen" | "comma" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const TWO_CHAR_OPERATORS = new Set([">=", "<=", "==", "!="]);
const ONE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "^", "%", ">", "<"]);

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_.]/.test(c);

export function tokenize(source: string): Token[] {
  if (source.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError("limit", `Formula is too long (max ${MAX_FORMULA_LENGTH} characters).`);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(source[i + 1] ?? ""))) {
      const start = i;
      while (i < source.length && (isDigit(source[i]!) || source[i] === "_")) i++;
      if (source[i] === ".") {
        i++;
        while (i < source.length && (isDigit(source[i]!) || source[i] === "_")) i++;
      }
      if ((source[i] === "e" || source[i] === "E") && /[0-9+-]/.test(source[i + 1] ?? "")) {
        i++;
        if (source[i] === "+" || source[i] === "-") i++;
        if (!isDigit(source[i] ?? "")) throw new FormulaError("syntax", "Invalid number exponent.", start);
        while (i < source.length && isDigit(source[i]!)) i++;
      }
      const raw = source.slice(start, i).replace(/_/g, "");
      tokens.push({ type: "number", value: raw, pos: start });
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i]!)) i++;
      const name = source.slice(start, i);
      if (name.endsWith(".")) throw new FormulaError("syntax", `Invalid name "${name}".`, start);
      tokens.push({ type: "identifier", value: name, pos: start });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      tokens.push({ type: "operator", value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPERATORS.has(c)) {
      tokens.push({ type: "operator", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "(") tokens.push({ type: "lparen", value: c, pos: i });
    else if (c === ")") tokens.push({ type: "rparen", value: c, pos: i });
    else if (c === ",") tokens.push({ type: "comma", value: c, pos: i });
    else throw new FormulaError("syntax", `Unexpected character "${c}".`, i);
    i++;
  }
  tokens.push({ type: "eof", value: "", pos: source.length });
  return tokens;
}
