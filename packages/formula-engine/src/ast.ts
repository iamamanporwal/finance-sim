export type BinaryOperator = "+" | "-" | "*" | "/" | "^" | ">" | ">=" | "<" | "<=" | "==" | "!=";
export type UnaryOperator = "-" | "+";

interface BaseNode {
  /** Start offset in the source string. */
  pos: number;
}

export interface NumberNode extends BaseNode {
  kind: "number";
  /** Kept as the literal source text so Decimal parses it without float loss. */
  value: string;
}

export interface IdentifierNode extends BaseNode {
  kind: "identifier";
  name: string;
}

export interface UnaryNode extends BaseNode {
  kind: "unary";
  op: UnaryOperator;
  arg: FormulaNode;
}

/** Postfix percent: `20%` → 0.2 */
export interface PercentNode extends BaseNode {
  kind: "percent";
  arg: FormulaNode;
}

export interface BinaryNode extends BaseNode {
  kind: "binary";
  op: BinaryOperator;
  left: FormulaNode;
  right: FormulaNode;
}

export interface CallNode extends BaseNode {
  kind: "call";
  name: string;
  args: FormulaNode[];
}

export type FormulaNode = NumberNode | IdentifierNode | UnaryNode | PercentNode | BinaryNode | CallNode;
