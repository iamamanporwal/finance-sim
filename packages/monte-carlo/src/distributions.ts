import type { Distribution } from "@fin/model-schema";
import type { Rng } from "@fin/simulation-engine";

/** Standard normal via Box–Muller (uses two uniforms, deterministic for a given RNG). */
function standardNormal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Draws one value from a distribution. `center` is the parameter's value (used by "fixed" and a mean-less normal). */
export function sample(d: Distribution | undefined, center: number, rng: Rng): number {
  if (!d) return center;
  switch (d.type) {
    case "fixed":
      return center;
    case "uniform":
      return d.min + (d.max - d.min) * rng.next();
    case "normal":
      return (d.mean ?? center) + d.stdDev * standardNormal(rng);
    case "triangular": {
      const { min: a, mode: c, max: b } = d;
      if (b === a) return a;
      const u = rng.next();
      const f = (c - a) / (b - a);
      return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
    }
    case "lognormal": {
      // Parameterised by the mean and standard deviation of the value itself.
      const variance = d.stdDev ** 2;
      const sigma2 = Math.log(1 + variance / d.mean ** 2);
      const mu = Math.log(d.mean) - sigma2 / 2;
      return Math.exp(mu + Math.sqrt(sigma2) * standardNormal(rng));
    }
    case "discrete": {
      const total = d.outcomes.reduce((s, o) => s + Math.max(0, o.weight), 0);
      let u = rng.next() * total;
      for (const o of d.outcomes) {
        u -= Math.max(0, o.weight);
        if (u < 0) return o.value;
      }
      return d.outcomes[d.outcomes.length - 1]!.value;
    }
  }
}

/**
 * Moves a distribution along with a changed value (e.g. a scenario overrides
 * the value but not its uncertainty): the spread scales with the value.
 */
export function rescaleDistribution(d: Distribution | undefined, from: number, to: number): Distribution | undefined {
  if (!d || from === to || from === 0) return d;
  const k = to / from;
  switch (d.type) {
    case "uniform":
      return k > 0 ? { ...d, min: d.min * k, max: d.max * k } : { ...d, min: d.max * k, max: d.min * k };
    case "triangular":
      return k > 0 ? { ...d, min: d.min * k, mode: d.mode * k, max: d.max * k } : { ...d, min: d.max * k, mode: d.mode * k, max: d.min * k };
    case "normal":
      return { ...d, mean: (d.mean ?? from) * k, stdDev: d.stdDev * Math.abs(k) };
    case "lognormal":
      return k > 0 ? { ...d, mean: d.mean * k, stdDev: d.stdDev * k } : d;
    default:
      return d;
  }
}
