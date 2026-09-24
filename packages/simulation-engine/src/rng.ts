/**
 * Seeded pseudo-random number generator (mulberry32). All randomness in the
 * engine goes through this so that the same model, parameters and seed always
 * produce identical results.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    seed,
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Derives an independent child seed (e.g. one per Monte Carlo run) from a base seed. */
export function deriveSeed(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
