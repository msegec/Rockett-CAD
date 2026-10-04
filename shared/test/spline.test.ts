import { describe, expect, it } from "vitest";
import {
  bsplineDistance,
  bsplinePoint,
  bsplineProblem,
  sampleBSpline,
  type BSpline,
} from "../src/bspline.js";
import { regionWarning } from "../src/curveLimits.js";
import { dxfSplines, importDxf } from "../src/importDxf.js";
import type { SketchEntity } from "../src/model.js";
import { detectProfiles } from "../src/profiles.js";
import { curveSamples, sketchCurves } from "../src/sketchCurves.js";
import { extendSketch, offsetSketch } from "../src/sketchModify.js";
import { moveSketchSelection } from "../src/sketchTransform.js";
import { trimmable, trimSketch } from "../src/sketchTrim.js";

type Pair = [number, string | number];

const R = Math.SQRT1_2;

const quarter: BSpline = {
  degree: 2,
  poles: [
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  weights: [1, R, 1],
  knots: [0, 1],
  multiplicities: [3, 3],
};

const circle: BSpline = {
  degree: 2,
  poles: [
    [2, 0],
    [2, 2],
    [0, 2],
    [-2, 2],
    [-2, 0],
    [-2, -2],
    [0, -2],
    [2, -2],
    [2, 0],
  ],
  weights: [1, R, 1, R, 1, R, 1, R, 1],
  knots: [0, 0.25, 0.5, 0.75, 1],
  multiplicities: [3, 2, 2, 2, 3],
};

const periodic: BSpline = {
  degree: 3,
  poles: [
    [0, 0],
    [4, 0],
    [6, 3],
    [4, 6],
    [0, 6],
    [-2, 3],
  ],
  weights: [1, 2, 1, 0.5, 1, 1],
  knots: [3, 4, 5, 6, 7, 8, 9],
  multiplicities: [1, 1, 1, 1, 1, 1, 1],
  periodic: true,
};

function dxf(entities: Pair[][], header: Pair[] = []): string {
  const pairs: Pair[] = [
    [0, "SECTION"],
    [2, "HEADER"],
    ...header,
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "ENTITIES"],
    ...entities.flat(),
    [0, "ENDSEC"],
    [0, "EOF"],
  ];
  return pairs.map(([code, value]) => `${code}\n${value}`).join("\n");
}

function splineRecord(
  degree: number,
  knots: number[],
  poles: [number, number][],
  weights: number[] = [],
  extra: Pair[] = [],
): Pair[] {
  return [
    [0, "SPLINE"],
    [8, "0"],
    ...extra,
    [210, 0],
    [220, 0],
    [230, 1],
    [70, weights.length > 0 ? 12 : 8],
    [71, degree],
    [72, knots.length],
    [73, poles.length],
    [74, 0],
    ...knots.map((k): Pair => [40, k]),
    ...weights.map((w): Pair => [41, w]),
    ...poles.flatMap(([x, y]): Pair[] => [
      [10, x],
      [20, y],
      [30, 0],
    ]),
  ];
}

describe("bsplineProblem", () => {
  it("accepts clamped, rational and periodic data", () => {
    expect(bsplineProblem(quarter)).toBeUndefined();
    expect(bsplineProblem(circle)).toBeUndefined();
    expect(bsplineProblem(periodic)).toBeUndefined();
  });

  it.each<[string, Partial<BSpline>, RegExp]>([
    ["degree 0", { degree: 0 }, /degree/],
    ["a fractional degree", { degree: 1.5 }, /degree/],
    ["one pole short", { poles: quarter.poles.slice(0, 2) }, /3 poles/],
    [
      "a pole that is not a number",
      {
        poles: [
          [1, 0],
          [1, NaN],
          [0, 1],
        ],
      },
      /poles/,
    ],
    ["a missing weight", { weights: [1, R] }, /weight/],
    ["a zero weight", { weights: [1, 0, 1] }, /weight/],
    ["a negative weight", { weights: [1, -R, 1] }, /weight/],
    ["repeated knots", { knots: [0, 0] }, /increasing/],
    ["decreasing knots", { knots: [1, 0] }, /increasing/],
    ["a single knot", { knots: [0], multiplicities: [3] }, /two knots/],
    ["a missing multiplicity", { multiplicities: [3] }, /multiplicit/],
    ["an unclamped open end", { multiplicities: [2, 3] }, /clamped/],
    [
      "an end multiplicity over degree + 1",
      { multiplicities: [4, 3] },
      /multiplicit/,
    ],
  ])("refuses %s", (_, change, message) => {
    expect(bsplineProblem({ ...quarter, ...change })).toMatch(message);
  });

  it("refuses periodic data with unequal ends or an end over degree", () => {
    expect(
      bsplineProblem({ ...periodic, multiplicities: [2, 1, 1, 1, 1, 1, 1] }),
    ).toMatch(/periodic/);
    expect(
      bsplineProblem({ ...periodic, multiplicities: [4, 1, 1, 1, 1, 1, 4] }),
    ).toMatch(/multiplicit/);
    expect(
      bsplineProblem({ ...periodic, poles: periodic.poles.slice(1) }),
    ).toMatch(/6 poles/);
  });

  it("refuses an interior multiplicity over the degree", () => {
    expect(
      bsplineProblem({ ...circle, multiplicities: [3, 3, 2, 2, 3] }),
    ).toMatch(/multiplicit/);
  });
});

describe("bspline evaluation", () => {
  it("puts every point of a rational quarter on the unit circle", () => {
    for (let i = 0; i <= 10; i++) {
      const [x, y] = bsplinePoint(quarter, i / 10);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
    }
    expect(bsplinePoint(quarter, 0)).toEqual([1, 0]);
    expect(bsplinePoint(quarter, 1)).toEqual([0, 1]);
    const [x, y] = bsplinePoint(quarter, 0.5);
    expect(x).toBeCloseTo(y, 12);
  });

  it("ignores weights that are all one only in name", () => {
    const plain = { ...quarter, weights: [1, 1, 1] };
    const [x, y] = bsplinePoint(plain, 0.5);
    expect(x).toBeCloseTo(0.75, 12);
    expect(y).toBeCloseTo(0.75, 12);
    const { weights: _, ...unweighted } = plain;
    expect(bsplinePoint(unweighted, 0.5)).toEqual(bsplinePoint(plain, 0.5));
  });

  it("repeats a periodic curve every period", () => {
    for (const u of [3, 3.4, 5.5, 8.9]) {
      const [x, y] = bsplinePoint(periodic, u);
      const [x2, y2] = bsplinePoint(periodic, u + 6);
      expect(x2).toBeCloseTo(x, 12);
      expect(y2).toBeCloseTo(y, 12);
    }
    const [sx, sy] = bsplinePoint(periodic, 3);
    const [ex, ey] = bsplinePoint(periodic, 9 - 1e-12);
    expect(ex).toBeCloseTo(sx, 9);
    expect(ey).toBeCloseTo(sy, 9);
  });

  it("samples every knot span from start to end", () => {
    const samples = sampleBSpline(circle, 6);
    expect(samples).toHaveLength(2 * (4 * 6 + 1));
    expect(samples.slice(0, 2)).toEqual([2, 0]);
    expect(samples.slice(-2)).toEqual([2, 0]);
    for (let i = 0; i < samples.length; i += 2)
      expect(Math.hypot(samples[i]!, samples[i + 1]!)).toBeCloseTo(2, 12);
  });

  it("finds the nearest distance to the curve", () => {
    expect(bsplineDistance(circle, 5, 1)).toBeCloseTo(Math.hypot(5, 1) - 2, 9);
    expect(bsplineDistance(circle, 0.3, -0.4)).toBeCloseTo(1.5, 9);
    expect(bsplineDistance(quarter, -1, -1)).toBeCloseTo(
      Math.min(Math.hypot(2, 1), Math.hypot(1, 2)),
      9,
    );
    expect(bsplineDistance(quarter, 2, 2)).toBeCloseTo(2 * Math.SQRT2 - 1, 9);
  });
});

describe("dxfSplines", () => {
  it("reads a clamped rational SPLINE to its exact data", () => {
    const text = dxf([
      splineRecord(2, [0, 0, 0, 1, 1, 1], quarter.poles, [1, R, 1]),
    ]);
    expect(dxfSplines(text)).toEqual({ splines: [quarter], skipped: [] });
  });

  it("scales poles by the drawing units", () => {
    const text = dxf(
      [
        splineRecord(
          1,
          [0, 0, 1, 1],
          [
            [0, 0],
            [1, 2],
          ],
        ),
      ],
      [
        [9, "$INSUNITS"],
        [70, 1],
      ],
    );
    expect(dxfSplines(text).splines).toEqual([
      {
        degree: 1,
        poles: [
          [0, 0],
          [25.4, 50.8],
        ],
        knots: [0, 1],
        multiplicities: [2, 2],
      },
    ]);
  });

  it("turns a closed SPLINE whose last poles repeat its first into the periodic form", () => {
    const poles = [...periodic.poles, ...periodic.poles.slice(0, 3)];
    const weights = [...periodic.weights!, ...periodic.weights!.slice(0, 3)];
    const knots = Array.from({ length: 13 }, (_, i) => i);
    const { splines, skipped } = dxfSplines(
      dxf([splineRecord(3, knots, poles, weights, [[70, 15]])]),
    );
    expect(skipped).toEqual([]);
    expect(splines).toEqual([periodic]);
  });

  it("counts fit-point-only, unclamped open and malformed SPLINEs as skipped", () => {
    const fitOnly: Pair[] = [
      [0, "SPLINE"],
      [70, 8],
      [71, 3],
      [72, 0],
      [73, 0],
      [74, 3],
      [11, 0],
      [21, 0],
      [11, 5],
      [21, 5],
      [11, 9],
      [21, 1],
    ];
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const { splines, skipped } = dxfSplines(
      dxf([
        fitOnly,
        splineRecord(2, [0, 1, 2, 3, 4, 5, 6], square),
        splineRecord(2, [0, 0, 0, 1, 1, 1], square),
        splineRecord(2, [0, 0, 0, 1, 2, 2, 2], square, [1, 1, 1]),
        splineRecord(2, [0, 0, 0, 1, 2, 2, 2], square, [1, 1, -1, 1]),
        splineRecord(2, [0, 0, 1, 0, 2, 2, 2], square),
        splineRecord(2, [0, 0, 0, 1, 2, 2, 2], square, [], [[72, 9]]),
        line(),
      ]),
    );
    expect(splines).toEqual([]);
    expect(skipped).toHaveLength(7);
    expect(skipped[0]).toMatch(/fit points/);
    expect(skipped[1]).toMatch(/clamped/);
    expect(skipped[2]).toMatch(/knots/);
    expect(skipped[3]).toMatch(/weight/);
    expect(skipped[4]).toMatch(/weight/);
    expect(skipped[5]).toMatch(/decrease/);
    expect(skipped[6]).toMatch(/9 knots/);
  });
});

function line(x1 = 0, y1 = 0, x2 = 1, y2 = 0): Pair[] {
  return [
    [0, "LINE"],
    [10, x1],
    [20, y1],
    [11, x2],
    [21, y2],
  ];
}

describe("spline sketch entity", () => {
  const square = (x: number, y: number, size: number): Pair[][] => [
    line(x, y, x + size, y),
    line(x + size, y, x + size, y + size),
    line(x + size, y + size, x, y + size),
    line(x, y + size, x, y),
  ];
  const arch = splineRecord(
    2,
    [0, 0, 0, 1, 1, 1],
    [
      [0, 0],
      [5, 8],
      [10, 0],
    ],
  );
  const imported = (...records: Pair[][]) => {
    const { entities, skipped } = importDxf(dxf(records));
    expect(skipped).toBe(0);
    return entities;
  };
  const splineOf = (entities: SketchEntity[]) =>
    entities.find((e) => e.kind === "spline")!;
  const at = (entities: SketchEntity[], id: string) => {
    const p = entities.find((e) => e.id === id);
    return p?.kind === "point" ? [p.x, p.y] : undefined;
  };

  it("imports a SPLINE as poles that share the ends of touching lines", () => {
    const entities = imported(
      splineRecord(2, [0, 0, 0, 1, 1, 1], quarter.poles, [1, R, 1]),
      line(0, 1, -1, 1),
    );
    const s = splineOf(entities);
    expect(s).toMatchObject({
      kind: "spline",
      degree: 2,
      weights: [1, R, 1],
      knots: [0, 1],
      multiplicities: [3, 3],
    });
    if (s.kind !== "spline") throw new Error("not a spline");
    expect(s.poles.map((id) => at(entities, id))).toEqual(quarter.poles);
    const l = entities.find((e) => e.kind === "line");
    expect(l?.kind === "line" && l.p1).toBe(s.poles[2]);
  });

  it("imports a periodic SPLINE with its flag and scales poles once", () => {
    const poles = [...periodic.poles, ...periodic.poles.slice(0, 3)];
    const weights = [...periodic.weights!, ...periodic.weights!.slice(0, 3)];
    const knots = Array.from({ length: 13 }, (_, i) => i);
    const { entities } = importDxf(
      dxf(
        [splineRecord(3, knots, poles, weights, [[70, 15]])],
        [
          [9, "$INSUNITS"],
          [70, 1],
        ],
      ),
    );
    const s = splineOf(entities);
    expect(s).toMatchObject({ periodic: true, knots: periodic.knots });
    if (s.kind !== "spline") throw new Error("not a spline");
    expect(s.poles.map((id) => at(entities, id))).toEqual(
      periodic.poles.map(([x, y]) => [x * 25.4, y * 25.4]),
    );
  });

  it("skips a SPLINE whose plane is not the drawing plane", () => {
    const tilted = splineRecord(
      1,
      [0, 0, 1, 1],
      quarter.poles.slice(0, 2),
      [],
      [
        [210, 1],
        [220, 0],
        [230, 0],
      ],
    );
    expect(importDxf(dxf([tilted])).skipped).toBe(1);
  });

  it("samples the exact curve for drawing", () => {
    const entities = imported(
      splineRecord(2, [0, 0, 0, 1, 1, 1], quarter.poles, [1, R, 1]),
    );
    const [curve] = sketchCurves(entities);
    const flat = curveSamples(curve!, 12);
    expect(flat.length).toBe(26);
    for (let i = 0; i < flat.length; i += 2)
      expect(Math.hypot(flat[i]!, flat[i + 1]!)).toBeCloseTo(1, 12);
  });

  it("forms no region and warns, while the lines around it still do", () => {
    const entities = imported(arch, ...square(-20, -20, 60));
    const s = splineOf(entities);
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
    expect(JSON.stringify(profiles)).not.toContain(s.id);
    expect(regionWarning(entities)).toMatch(
      new RegExp(`Spline ${s.id} forms no region yet`),
    );
    expect(regionWarning(imported(...square(0, 0, 5)))).toBeUndefined();
  });

  it("refuses to trim the spline or a curve it crosses", () => {
    const entities = imported(arch, line(5, -5, 5, 10), line(20, 0, 30, 0));
    const s = splineOf(entities);
    const crossing = entities.filter((e) => e.kind === "line")[0]!;
    const clear = entities.filter((e) => e.kind === "line")[1]!;
    expect(trimmable(entities, s)).toBe(false);
    expect(trimmable(entities, crossing)).toBe(false);
    expect(trimmable(entities, clear)).toBe(true);
    expect(() => trimSketch(entities, [], s.id, { x: 5, y: 4 })).toThrow(
      /does not support splines/,
    );
    expect(() => trimSketch(entities, [], crossing.id, { x: 5, y: 8 })).toThrow(
      /splines/,
    );
  });

  it("keeps a curve that only meets the spline at its end trimmable", () => {
    const entities = imported(arch, line(10, 0, 20, 0), line(15, -5, 15, 5));
    const joined = entities.find(
      (e) => e.kind === "line" && at(entities, e.p1)?.[0] === 10,
    )!;
    expect(trimmable(entities, joined)).toBe(true);
  });

  it("refuses to extend or offset the spline, and to extend beside it", () => {
    const entities = imported(arch, line(20, 0, 30, 0));
    const s = splineOf(entities);
    const l = entities.find((e) => e.kind === "line")!;
    expect(() => extendSketch(entities, [], s.id, { x: 0, y: 0 })).toThrow(
      /does not support splines/,
    );
    expect(() => offsetSketch(entities, [], s.id, 1)).toThrow(/spline/i);
    expect(() => extendSketch(entities, [], l.id, { x: 20, y: 0 })).toThrow(
      /does not support splines/,
    );
  });

  it("copies a spline onto fresh poles", () => {
    const entities = imported(arch);
    const s = splineOf(entities);
    const { entities: after } = moveSketchSelection(entities, [], [s.id], {
      dx: 5,
      dy: 1,
      angle: 0,
      pivot: null,
      copy: true,
      bound: [],
    });
    const copy = after.find((e) => e.kind === "spline" && e.id !== s.id);
    if (copy?.kind !== "spline" || s.kind !== "spline")
      throw new Error("no copy");
    expect(copy.poles.some((id) => s.poles.includes(id))).toBe(false);
    expect(copy.poles.map((id) => at(after, id))).toEqual([
      [5, 1],
      [10, 9],
      [15, 1],
    ]);
  });
});
