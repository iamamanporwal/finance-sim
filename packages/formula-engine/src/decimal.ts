import DecimalBase from "decimal.js";

/**
 * Isolated Decimal constructor for all financial math. Cloned so that global
 * Decimal configuration elsewhere can never change engine precision.
 */
export const Decimal = DecimalBase.clone({
  precision: 34,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = Decimal | number | string;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function dec(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function isDecimal(value: unknown): value is Decimal {
  return value instanceof Decimal;
}
