import { describe, expect, it } from "vitest";
import {
  boundConstraintIds,
  createEmptyDocument,
  editedEntities,
  movedBindings,
  resolveDocumentParameters,
  FixedEntityError,
  moveSketchSelection,
  solveSketch,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchPoint,
} from "../src/index.js";

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

const rect: SketchEntity[] = [
  P("a", 0, 0),
  P("b", 102, 0),
  P("c", 102, 60),
  P("d", 0, 60),
  L("bottom", "a", "b"),
  L("right", "b", "c"),
  L("top", "c", "d"),
  L("left", "d", "a"),
];
const rectConstraints: SketchConstraint[] = [
  { id: "hb", type: "horizontal", line: "bottom" },
  { id: "ht", type: "horizontal", line: "top" },
  { id: "vr", type: "vertical", line: "right" },
  { id: "vl", type: "vertical", line: "left" },
  { id: "width", type: "length", line: "bottom", value: 102 },
  { id: "height", type: "length", line: "right", value: 60 },
];
const lines = ["bottom", "right", "top", "left"];
const move = { dx: 10, dy: 5, angle: 30, pivot: null, copy: false, bound: [] };

const point = (entities: SketchEntity[], id: string) =>
  entities.find((e) => e.id === id) as SketchPoint;
const centre = (entities: SketchEntity[], ids: string[]) => {
  const ps = ids.map((id) => point(entities, id));
  return {
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  };
};
const dof = (entities: SketchEntity[], constraints: SketchConstraint[]) =>
  solveSketch({ entities, constraints }).dof;

describe("moveSketchSelection", () => {
  it("moves a constrained rectangle 10, 5 mm and 30 degrees, centred there, keeping its constraints", () => {
    const result = moveSketchSelection(rect, rectConstraints, lines, move);

    expect(result.removedConstraints).toBe(0);
    expect(result.constraints.map((c) => c.id)).toEqual(
      rectConstraints.map((c) => c.id),
    );
    const c = centre(result.entities, ["a", "b", "c", "d"]);
    expect(c.x).toBeCloseTo(61, 9);
    expect(c.y).toBeCloseTo(35, 9);
    const a = point(result.entities, "a"),
      b = point(result.entities, "b");
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(
      30,
      9,
    );
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(102, 9);
    expect(result.constraints.find((k) => k.id === "hb")).toMatchObject({
      type: "lineAngle",
      line: "bottom",
    });
    expect(
      editedEntities(rectConstraints, {
        entities: result.entities,
        constraints: result.constraints,
      }),
    ).toEqual(result.entities);
    expect(
      solveSketch({
        entities: result.entities,
        constraints: result.constraints,
      }).converged,
    ).toBe(true);
    expect(dof(result.entities, result.constraints)).toBe(
      dof(rect, rectConstraints),
    );
  });

  it("keeps horizontal and vertical on a pure move and swaps them at 90 degrees", () => {
    const moved = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: 0,
    });
    expect(moved.constraints).toEqual(rectConstraints);
    const turned = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: 90,
    });
    expect(turned.constraints.find((k) => k.id === "hb")).toMatchObject({
      type: "vertical",
    });
    expect(turned.constraints.find((k) => k.id === "vr")).toMatchObject({
      type: "horizontal",
    });
  });

  it("keeps horizontal and vertical at 180 degrees and swaps them at -90", () => {
    const half = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: 180,
    });
    expect(half.constraints).toEqual(rectConstraints);
    const back = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: -90,
    });
    expect(back.constraints.map((k) => k.type)).toEqual([
      "vertical",
      "vertical",
      "horizontal",
      "horizontal",
      "length",
      "length",
    ]);
  });

  it("swaps an x distance to y at 90 degrees", () => {
    const width: SketchConstraint = {
      id: "dx",
      type: "distance",
      a: "a",
      b: "b",
      axis: "x",
      value: 102,
    };
    const result = moveSketchSelection(rect, [width], lines, {
      ...move,
      angle: 90,
    });
    expect(result.constraints).toEqual([{ ...width, axis: "y" }]);
  });

  it("drops a parameter-bound angle a rotation would change, and the document resolves in place", () => {
    const constraints: SketchConstraint[] = [
      { id: "ab", type: "lineAngle", line: "bottom", value: 0 },
      ...rectConstraints.slice(1),
    ];
    const doc = createEmptyDocument("proj", "doc");
    const saved: SketchFeature = {
      id: "s1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: rect,
      constraints,
    };
    doc.features = [saved];
    doc.timelinePosition = 1;
    doc.parameterBindings = [
      { featureId: "s1", path: "/constraints/0/value", expression: "0 deg" },
    ];
    const bound = boundConstraintIds(doc.parameterBindings, saved);
    expect(bound).toEqual(["ab"]);

    const result = moveSketchSelection(rect, constraints, lines, {
      ...move,
      bound,
    });
    expect(result.removedConstraints).toBe(1);
    expect(result.constraints.map((c) => c.id)).not.toContain("ab");

    const draft = { ...saved, ...result };
    const bindings = movedBindings(doc.parameterBindings, saved, draft);
    const resolved = resolveDocumentParameters({
      ...doc,
      features: [draft],
      parameterBindings: bindings,
    }).features[0] as SketchFeature;
    const solved = solveSketch(resolved);
    expect(solved.converged).toBe(true);
    const a = point(solved.entities, "a"),
      b = point(solved.entities, "b");
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(
      30,
      6,
    );
  });

  it("rotates about a picked point", () => {
    const result = moveSketchSelection(rect, rectConstraints, lines, {
      dx: 0,
      dy: 0,
      angle: 90,
      pivot: { x: 0, y: 0 },
      copy: false,
      bound: [],
    });
    expect(point(result.entities, "b").x).toBeCloseTo(0, 9);
    expect(point(result.entities, "b").y).toBeCloseTo(102, 9);
  });

  it("Copy leaves the original and adds a second rectangle with its own constraints", () => {
    const result = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      copy: true,
    });

    expect(result.entities.slice(0, rect.length)).toEqual(rect);
    expect(result.constraints.slice(0, rectConstraints.length)).toEqual(
      rectConstraints,
    );
    const added = result.entities.slice(rect.length);
    const copies = result.constraints.slice(rectConstraints.length);
    expect(added.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(added.filter((e) => e.kind === "point")).toHaveLength(4);
    expect(copies).toHaveLength(rectConstraints.length);
    const old = new Set(rect.map((e) => e.id));
    const fresh = new Set(added.map((e) => e.id));
    for (const k of copies) {
      expect(rectConstraints.some((r) => r.id === k.id)).toBe(false);
      for (const ref of Object.values(k).filter(
        (v): v is string => typeof v === "string" && old.has(v),
      ))
        expect(fresh.has(ref)).toBe(true);
    }
    expect(
      editedEntities(rectConstraints, {
        entities: result.entities,
        constraints: result.constraints,
      }),
    ).toEqual(result.entities);
    expect(dof(result.entities, result.constraints)).toBe(
      2 * dof(rect, rectConstraints),
    );
  });

  it("drops a coincident to an unselected point and counts it", () => {
    const entities = [P("p1", 0, 0), P("p2", 10, 0), L("l", "p1", "p2")];
    const constraints: SketchConstraint[] = [
      { id: "h", type: "horizontal", line: "l" },
      { id: "on", type: "coincident", a: "p1", b: "u" },
    ];
    const result = moveSketchSelection(
      [...entities, P("u", 0, 0)],
      constraints,
      ["l"],
      { ...move, angle: 0 },
    );
    expect(result.removedConstraints).toBe(1);
    expect(result.constraints.map((c) => c.id)).toEqual(["h"]);
    expect(point(result.entities, "u")).toEqual(P("u", 0, 0));
    expect(point(result.entities, "p1")).toMatchObject({ x: 10, y: 5 });
  });

  it("leaves unselected curves where they were when they share a moved point", () => {
    const result = moveSketchSelection(rect, rectConstraints, ["bottom"], {
      ...move,
      angle: 0,
    });
    const right = result.entities.find((e) => e.id === "right")!;
    expect(right.kind === "line" && right.p1).not.toBe("b");
    const corner = point(result.entities, (right as { p1: string }).p1);
    expect(corner).toMatchObject({ x: 102, y: 0 });
    expect(point(result.entities, "b")).toMatchObject({ x: 112, y: 5 });
  });

  it("refuses to move a fixed line, naming it, and still copies it", () => {
    const entities = [P("p1", 0, 0), P("p2", 10, 0), L("l", "p1", "p2")];
    const constraints: SketchConstraint[] = [
      { id: "f", type: "fix", point: "p1" },
    ];
    let error: unknown;
    try {
      moveSketchSelection(entities, constraints, ["l"], move);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FixedEntityError);
    expect(error).toMatchObject({ entityId: "l", reason: "fixed" });
    const copied = moveSketchSelection(entities, constraints, ["l"], {
      ...move,
      copy: true,
    });
    expect(copied.entities.slice(0, 3)).toEqual(entities);
    expect(copied.entities).toHaveLength(6);
    expect(copied.constraints).toEqual(constraints);
  });
});

it("refuses to move a projected line and copies it as plain geometry", () => {
  const entities: SketchEntity[] = [
    { id: "p1", kind: "point", x: 0, y: 0, external: true },
    { id: "p2", kind: "point", x: 10, y: 0, external: true },
    {
      id: "l",
      kind: "line",
      p1: "p1",
      p2: "p2",
      external: true,
      projection: { kind: "edge", bodyId: "b", edgeName: "e" },
    },
  ];
  expect(() => moveSketchSelection(entities, [], ["l"], move)).toThrow(
    expect.objectContaining({ entityId: "l", reason: "reference" }),
  );
  const copied = moveSketchSelection(entities, [], ["l"], {
    ...move,
    copy: true,
  });
  for (const e of copied.entities.slice(3)) {
    expect(e.external).toBeUndefined();
    expect("projection" in e).toBe(false);
  }
});
