import { ARC_SEGMENTS, least, type XY } from "./sketchCurves.js";
import { LINEAR_TOL } from "./tolerance.js";

export type BSpline = {
  degree: number;
  poles: XY[];
  weights?: number[];
  knots: number[];
  multiplicities: number[];
  periodic?: boolean;
};

const MAX_DEGREE = 25;
const PERIOD_TOL = 1e-9;

const whole = (v: number, lo: number, hi: number) =>
  Number.isInteger(v) && v >= lo && v <= hi;
const mod = (i: number, n: number) => ((i % n) + n) % n;

const degreeProblem = (p: number) =>
  whole(p, 1, MAX_DEGREE)
    ? undefined
    : `degree must be a whole number from 1 to ${MAX_DEGREE}`;

export function bsplineProblem(s: BSpline): string | undefined {
  const { degree: p, poles, weights, knots, multiplicities: m } = s;
  if (degreeProblem(p)) return degreeProblem(p);
  if (knots.length < 2) return "needs at least two knots";
  if (m.length !== knots.length) return "needs one multiplicity per knot";
  if (
    !knots.every((k, i) => Number.isFinite(k) && (i === 0 || k > knots[i - 1]!))
  )
    return "knots must be finite and strictly increasing";
  const end = s.periodic ? p : p + 1;
  const inner = (i: number) => i > 0 && i < m.length - 1;
  if (!m.every((v, i) => whole(v, 1, inner(i) ? p : end)))
    return `multiplicities must be whole numbers from 1 to ${p} inside and ${end} at the ends`;
  if (s.periodic && m[0] !== m.at(-1))
    return "a periodic spline needs equal end multiplicities";
  if (!s.periodic && (m[0] !== end || m.at(-1) !== end))
    return `an open spline must be clamped: end multiplicities must be ${end}`;
  const count = m.reduce((a, b) => a + b, 0) - (s.periodic ? m.at(-1)! : p + 1);
  if (poles.length !== count || count < 2)
    return `needs ${count} poles, got ${poles.length}`;
  if (!poles.every((pole) => pole.length === 2 && pole.every(Number.isFinite)))
    return "poles must be finite x, y pairs";
  if (
    weights &&
    (weights.length !== count ||
      !weights.every((w) => Number.isFinite(w) && w > 0))
  )
    return "needs one positive weight per pole";
  return undefined;
}

function frame(s: BSpline) {
  const n = s.poles.length;
  const flat = s.knots.flatMap((k, i) =>
    Array<number>(s.multiplicities[i]!).fill(k),
  );
  const [first, last] = [s.knots[0]!, s.knots.at(-1)!];
  if (!s.periodic)
    return {
      knot: (j: number) => flat[j]!,
      pole: (i: number) => i,
      lo: s.degree,
      at: (u: number) => Math.min(last, Math.max(first, u)),
    };
  const period = last - first;
  return {
    knot: (j: number) => flat[mod(j, n)]! + period * Math.floor(j / n),
    pole: (i: number) => mod(i + s.degree + 1 - s.multiplicities[0]!, n),
    lo: 0,
    at: (u: number) => first + mod(u - first, period),
  };
}

export function bsplinePoint(s: BSpline, u: number): XY {
  const p = s.degree;
  const { knot, pole, lo, at } = frame(s);
  const t = at(u);
  let span = lo;
  while (span < s.poles.length - 1 && knot(span + 1) <= t) span++;
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const i = pole(span - p + j);
    const w = s.weights?.[i] ?? 1;
    const [x, y] = s.poles[i]!;
    return [x * w, y * w, w];
  });
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const a = (t - knot(i)) / (knot(i + p + 1 - r) - knot(i));
      d[j] = d[j]!.map((v, c) => (1 - a) * d[j - 1]![c]! + a * v);
    }
  const [x, y, w] = d[p]!;
  return [x! / w!, y! / w!];
}

function bsplineParams(s: BSpline, segments: number): number[] {
  const out = [s.knots[0]!];
  for (let i = 1; i < s.knots.length; i++) {
    const [a, b] = [s.knots[i - 1]!, s.knots[i]!];
    for (let j = 1; j <= segments; j++) out.push(a + ((b - a) * j) / segments);
  }
  return out;
}

export function sampleBSpline(s: BSpline, segments = ARC_SEGMENTS): number[] {
  return bsplineParams(s, segments).flatMap((u) => bsplinePoint(s, u));
}

export function bsplineDistance(s: BSpline, x: number, y: number): number {
  const us = bsplineParams(s, ARC_SEGMENTS);
  const gap = (u: number) => {
    const [px, py] = bsplinePoint(s, u);
    return Math.hypot(px - x, py - y);
  };
  const gaps = us.map(gap);
  const best = gaps.indexOf(Math.min(...gaps));
  const period = us.at(-1)! - us[0]!;
  const lo = us[best - 1] ?? (s.periodic ? us.at(-2)! - period : us[0]!);
  const hi = us[best + 1] ?? (s.periodic ? us[1]! + period : us.at(-1)!);
  return Math.min(gaps[best]!, gap(least(gap, lo, hi)));
}

function runs(values: number[]): [number[], number[]] {
  const knots: number[] = [];
  const mults: number[] = [];
  for (const v of values) {
    if (v === knots.at(-1)) mults[mults.length - 1]!++;
    else {
      knots.push(v);
      mults.push(1);
    }
  }
  return [knots, mults];
}

const near = (a: number, b: number, tol: number) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a));

export function bsplineFromFlat(
  degree: number,
  poles: XY[],
  weights: number[] | undefined,
  flat: number[],
): BSpline | string {
  const p = degree;
  if (degreeProblem(p)) return degreeProblem(p)!;
  const size = poles.length + p + 1;
  if (flat.length !== size)
    return `needs ${size} knots for ${poles.length} poles of degree ${p}, got ${flat.length}`;
  if (flat.some((k, i) => i > 0 && !(k >= flat[i - 1]!)))
    return "knots must not decrease";
  if (weights && weights.length !== poles.length)
    return "needs one weight per pole";
  const clamped =
    flat.slice(0, p + 1).every((k) => k === flat[0]) &&
    flat.slice(-p - 1).every((k) => k === flat.at(-1));
  const spline = clamped
    ? clampedForm(p, poles, weights, flat)
    : periodicForm(p, poles, weights, flat);
  return typeof spline === "string"
    ? spline
    : (bsplineProblem(spline) ?? spline);
}

function clampedForm(
  p: number,
  poles: XY[],
  weights: number[] | undefined,
  flat: number[],
) {
  const [knots, multiplicities] = runs(flat);
  return {
    degree: p,
    poles,
    ...(weights && { weights }),
    knots,
    multiplicities,
  };
}

function periodicForm(
  p: number,
  poles: XY[],
  weights: number[] | undefined,
  flat: number[],
): BSpline | string {
  const n = poles.length - p;
  const period = flat[p + n]! - flat[p]!;
  const repeats =
    n > 1 &&
    poles.slice(n).every(([x, y], j) => {
      const [x0, y0] = poles[j]!;
      return Math.hypot(x - x0, y - y0) <= LINEAR_TOL;
    }) &&
    (weights ?? [])
      .slice(n)
      .every((w, j) => near(w, weights![j]!, PERIOD_TOL)) &&
    flat.slice(n).every((k, i) => near(k - flat[i]!, period, PERIOD_TOL));
  if (!repeats)
    return "an open spline must be clamped; only a closed one whose last poles repeat its first converts to periodic";
  const [knots, mults] = runs(flat.slice(p, p + n + 1));
  const front = mults[0]!;
  mults[0] = mults[mults.length - 1] = front + mults.at(-1)! - 1;
  const shift = (j: number) => (j + front - 1) % n;
  return {
    degree: p,
    poles: poles.slice(0, n).map((_, j) => poles[shift(j)]!),
    ...(weights && {
      weights: weights.slice(0, n).map((_, j) => weights[shift(j)]!),
    }),
    knots,
    multiplicities: mults,
    periodic: true,
  };
}
