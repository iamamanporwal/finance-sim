export type FormulaErrorKind = "syntax" | "evaluation" | "limit";

export class FormulaError extends Error {
  readonly kind: FormulaErrorKind;
  /** 0-based character offset into the source, when known. */
  readonly position: number | undefined;

  constructor(kind: FormulaErrorKind, message: string, position?: number) {
    super(message);
    this.name = "FormulaError";
    this.kind = kind;
    this.position = position;
  }
}

export const MAX_FORMULA_LENGTH = 2000;
export const MAX_AST_DEPTH = 64;
